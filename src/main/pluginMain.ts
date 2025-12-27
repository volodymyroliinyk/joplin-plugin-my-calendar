// src/main/pluginMain.ts
import {createCalendarPanel} from '../calendarView';
import {EventInput} from '../eventParser';

import {ensureAllEventsCache, invalidateNote, invalidateAllEventsCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';


const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;
let rebuilding = false;
let importPanelId: string | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;
type Occurrence = EventInput & { occurrenceId: string; startUtc: number; endUtc?: number };

function expandOccurrencesInRange(ev: EventInput, fromUtc: number, toUtc: number): Occurrence[] {
    const dur = (ev.endUtc ?? ev.startUtc) - ev.startUtc;
    const push = (start: number, out: Occurrence[]) => {
        if (start > toUtc) return false;
        const end = dur ? start + dur : start;
        if (end < fromUtc) return true;
        out.push({...ev, occurrenceId: `${ev.id}#${start}`, startUtc: start, endUtc: dur ? end : undefined});
        return true;
    };

    if (ev.repeat === 'none') {
        const end = ev.endUtc ?? ev.startUtc;
        if (end < fromUtc || ev.startUtc > toUtc) return [];
        return [{...ev, occurrenceId: `${ev.id}#${ev.startUtc}`}];
    }

    const out: Occurrence[] = [];
    const base = new Date(ev.startUtc);
    const baseY = base.getUTCFullYear(), baseM = base.getUTCMonth(), baseD = base.getUTCDate();
    const baseH = base.getUTCHours(), baseMin = base.getUTCMinutes(), baseS = base.getUTCSeconds();
    const until = ev.repeatUntilUtc ?? toUtc;
    const step = Math.max(1, ev.repeatInterval || 1);

    if (ev.repeat === 'daily') {
        let k = Math.floor((fromUtc - ev.startUtc) / (DAY_MS * step));
        if (ev.startUtc + k * step * DAY_MS < fromUtc) k++;
        if (k < 0) k = 0;
        for (; ; k++) {
            const start = ev.startUtc + k * step * DAY_MS;
            if (start > until) break;
            if (!push(start, out)) break;
        }
        return out;
    }

    if (ev.repeat === 'weekly') {
        const baseWd = (base.getUTCDay() + 6) % 7; // Mon=0
        const list = ev.byWeekdays && ev.byWeekdays.length ? ev.byWeekdays : [baseWd];
        const baseMidnight = Date.UTC(baseY, baseM, baseD);
        const mondayOfBase = baseMidnight - baseWd * DAY_MS;
        const timeOfDayOffset = ev.startUtc - baseMidnight;

        let weekIndex = Math.floor((fromUtc - mondayOfBase) / (7 * DAY_MS * step));
        if (mondayOfBase + weekIndex * 7 * DAY_MS * step + (list[0] * DAY_MS) + timeOfDayOffset < fromUtc) weekIndex++;
        if (weekIndex < 0) weekIndex = 0;

        for (; ; weekIndex++) {
            const weekStart = mondayOfBase + weekIndex * 7 * DAY_MS * step;
            if (weekStart > until) break;
            for (const wd of list) {
                const start = weekStart + wd * DAY_MS + timeOfDayOffset;
                if (start > until) continue;
                const keep = push(start, out);
                if (!keep) break;
            }
            if (weekStart > toUtc) break;
        }
        return out;
    }

    if (ev.repeat === 'monthly') {
        const dom = ev.byMonthDay ?? baseD;
        let y = baseY, m = baseM;
        let cursor = Date.UTC(y, m, dom, baseH, baseMin, baseS);
        while (cursor < ev.startUtc) {
            m += 1;
            cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS);
        }
        for (; ;) {
            if (cursor > until) break;
            const cd = new Date(cursor);
            const daysInMonth = new Date(Date.UTC(cd.getUTCFullYear(), cd.getUTCMonth() + 1, 0)).getUTCDate();
            if (dom <= daysInMonth) {
                if (!push(cursor, out)) break;
            }
            m += step;
            cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS);
            if (cursor > toUtc && cursor > until) break;
        }
        return out;
    }

    if (ev.repeat === 'yearly') {
        let y = baseY;
        let cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        while (cursor < ev.startUtc) {
            y += 1;
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        }
        while (cursor < fromUtc) {
            y += (step || 1);
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        }
        for (; ;) {
            if (cursor > until) break;
            const dt = new Date(cursor);
            const daysInMonth = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
            if (baseD <= daysInMonth) {
                if (!push(cursor, out)) break;
            }
            y += (step || 1);
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
            if (cursor > toUtc && cursor > until) break;
        }
        return out;
    }

    return out;
}

function expandAllInRange(evs: EventInput[], fromUtc: number, toUtc: number) {
    const out: Occurrence[] = [];
    for (const ev of evs) out.push(...expandOccurrencesInRange(ev, fromUtc, toUtc));
    out.sort((a, b) => a.startUtc - b.startUtc || a.occurrenceId.localeCompare(b.occurrenceId));
    return out;
}

function pad2(n: number) {
    return String(n).padStart(2, '0');
}

function fmtICS(tsUtc: number) {
    const d = new Date(tsUtc);
    return d.getUTCFullYear().toString() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
        'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function icsEscape(s: string) {
    return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildICS(events: Occurrence[], prodId = '-//MyCalendar//Joplin//EN') {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`, 'CALSCALE:GREGORIAN'];
    for (const ev of events) {
        const uid = ev.occurrenceId || `${ev.id}@mycalendar`;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${icsEscape(uid)}`);
        lines.push(`DTSTAMP:${fmtICS(Date.now())}`);
        lines.push(`DTSTART:${fmtICS(ev.startUtc)}`);
        if (ev.endUtc) lines.push(`DTEND:${fmtICS(ev.endUtc)}`);
        lines.push(`SUMMARY:${icsEscape(ev.title || 'Event')}`);
        if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
        if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
        if (ev.color) lines.push(`X-COLOR:${icsEscape(ev.color)}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

export default async function runPlugin(joplin: any) {

    console.log('[MyCalendar] pluginMain: start');

    const panel = await createCalendarPanel(joplin);
    console.log('[MyCalendar] panel id:', panel);

    await joplin.commands.register({
        name: 'mycalendar.open',
        label: 'Open MyCalendar',
        execute: async () => {
            await joplin.views.panels.show(panel);
            try {
                const panelsAny = (joplin as any).views?.panels;
                if (panelsAny && typeof panelsAny.focus === 'function') {
                    await panelsAny.focus(panel);
                }
            } catch (err) {
                // The mobile method is missing - it's expected
                console.log('[MyCalendar] panels.focus not available on this platform');
            }
        },
    });

    try {
        const all = await ensureAllEventsCache(joplin);
        console.log('[MyCalendar] events cached:', all.length);
    } catch (err) {
        console.error('[MyCalendar] ensureAllEventsCache error:', err);
    }

    await joplin.workspace.onNoteChange(async ({id}: { id?: string }) => {
        if (id) invalidateNote(id);
        invalidateAllEventsCache();
    });
    await joplin.workspace.onSyncComplete(async () => {
        allEventsCache = null;
    });

    await registerCalendarPanelController(joplin, panel, {
        expandAllInRange,
        buildICS,
    });

    await joplin.views.panels.show(panel);

    await registerDesktopToggle(joplin, panel);

    // --- Create the import panel (desktop)

    try {
        const panelsAny = (joplin as any).views?.panels;
        if (panelsAny && typeof panelsAny.focus === 'function') {
            await panelsAny.focus(panel);
        }
    } catch (err) {
        // On the mobil the method is missing - it's expected
        console.log('[MyCalendar] panels.focus not available on this platform');
    }
}

// === MyCalendar: safe desktop toggle helper ===
async function registerDesktopToggle(joplin: any, panelId: string) {
    try {
        const canShow = !!joplin?.views?.panels?.show;
        const canHide = !!joplin?.views?.panels?.hide;
        const canMenu = !!joplin?.views?.menuItems?.create;

        console.info('[MyCalendar] toggle: capabilities', {canShow, canHide, canMenu, panelId});

        if (!canShow || !canHide) {
            console.info('[MyCalendar] toggle: panels.show/hide not available - skip');
            return;
        }

        let mycalendarVisible = true;

        // 3.1 toggle  command
        await joplin.commands.register({
            name: 'mycalendar.togglePanel',
            label: 'Toggle MyCalendar panel',
            execute: async () => {
                try {
                    if (!panelId) return;
                    if (mycalendarVisible) {
                        // on Desktop there is Hide (); on Mobile there is no - just do nothing
                        if (joplin.views?.panels?.hide) {
                            await joplin.views.panels.hide(panelId);
                        }
                        mycalendarVisible = false;

                        console.log('[MyCalendar] toggle Hide');
                    } else {
                        await joplin.views.panels.show(panelId);
                        // We do not call Focus () - on Mobile of this method there is no → were errors in the lounges
                        mycalendarVisible = true;
                        console.log('[MyCalendar] toggle Show');
                    }
                } catch (e) {
                    console.log('[MyCalendar] toggle error', e);
                }
            },
        });

        try {
            await joplin.views.menuItems.create(
                'mycalendarToggleMenu',
                'mycalendar.togglePanel',
                'view'
            );
            console.log('[MyCalendar] toggle menu item registered');
        } catch (e) {
            console.log('[MyCalendar] menu create failed (non-fatal):', e);
        }

    } catch (e) {
        console.warn('[MyCalendar] registerDesktopToggle failed (non-fatal):', e);
    }
}




