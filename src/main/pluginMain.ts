// src/main/pluginMain.ts

import {createCalendarPanel} from './views/calendarView';
import {EventInput} from './parsers/eventParser';

import {ensureAllEventsCache, invalidateNote, invalidateAllEventsCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';
import {getDebugEnabled, getWeekStart, registerSettings} from './settings/settings';
import {setDebugEnabled} from './utils/logger';

let allEventsCache: EventInput[] | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;
type Occurrence = EventInput & { occurrenceId: string; startUtc: number; endUtc?: number };

function parseYmdHmsLocal(s: string): { Y: number; M: number; D: number; h: number; m: number; sec: number } {
    // "2025-09-01 15:30:00"
    const [d, t] = s.trim().split(/\s+/);
    const [Y, M, D] = d.split('-').map(n => parseInt(n, 10));
    const [h, m, sec] = (t || '00:00:00').split(':').map(n => parseInt(n, 10));
    return {Y, M, D, h, m, sec: sec || 0};
}

function addDaysYMD(Y: number, M: number, D: number, deltaDays: number): { Y: number; M: number; D: number } {
    const dt = new Date(Date.UTC(Y, M - 1, D) + deltaDays * DAY_MS);
    return {Y: dt.getUTCFullYear(), M: dt.getUTCMonth() + 1, D: dt.getUTCDate()};
}

function weekdayMon0(Y: number, M: number, D: number): number {
    // Monday=0..Sunday=6
    const dowSun0 = new Date(Date.UTC(Y, M - 1, D)).getUTCDay(); // Sun=0
    return (dowSun0 + 6) % 7;
}

function getPartsInTz(msUtc: number, tz: string): { Y: number; M: number; D: number } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(new Date(msUtc));
    const mp: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') mp[p.type] = p.value;
    return {Y: Number(mp.year), M: Number(mp.month), D: Number(mp.day)};
}

// Convert "local datetime in tz" -> UTC ms (handles DST correctly for that date)
function zonedTimeToUtcMs(localY: number, localM: number, localD: number, localH: number, localMin: number, localSec: number, tz: string): number {
    // initial guess: interpret local as UTC
    let guess = Date.UTC(localY, localM - 1, localD, localH, localMin, localSec);

    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(new Date(guess));
    const mp: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') mp[p.type] = p.value;

    const gotAsUtc = Date.UTC(
        Number(mp.year),
        Number(mp.month) - 1,
        Number(mp.day),
        Number(mp.hour),
        Number(mp.minute),
        Number(mp.second),
    );

    const wantAsUtc = Date.UTC(localY, localM - 1, localD, localH, localMin, localSec);
    return guess + (wantAsUtc - gotAsUtc);
}

function expandOccurrencesInRange(ev: EventInput, fromUtc: number, toUtc: number): Occurrence[] {
    // Invariant: recurring events must have timezone
    const tz = ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (ev.repeat !== 'none' && !ev.tz) {
        console.warn('[MyCalendar] recurring event has no tz; using device tz:', tz, ev.title, ev.id);
    }

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
        const from2 = fromUtc - Math.max(0, dur);
        let k = Math.floor((from2 - ev.startUtc) / (DAY_MS * step));
        if (ev.startUtc + k * step * DAY_MS < from2) k++;
        if (k < 0) k = 0;
        for (; ; k++) {
            const start = ev.startUtc + k * step * DAY_MS;
            if (start > until) break;
            if (!push(start, out)) break;
        }
        return out;
    }

    if (ev.repeat === 'weekly') {
        const tz = ev.tz;
        if (!tz) {
            // recurring without tz cannot be expanded safely
            return out; // or continue + warning
        }

        const baseLocal = parseYmdHmsLocal(ev.startText);
        const baseWd = weekdayMon0(baseLocal.Y, baseLocal.M, baseLocal.D);

        const list = ev.byWeekdays && ev.byWeekdays.length ? ev.byWeekdays : [baseWd];
        const step = Math.max(1, ev.repeatInterval || 1);
        const from2 = fromUtc - Math.max(0, dur);

        // Monday of base week (local date)
        const mondayBase = addDaysYMD(baseLocal.Y, baseLocal.M, baseLocal.D, -baseWd);

        // Start from the week containing "fromUtc" in local TZ
        const fromLocal = getPartsInTz(fromUtc, tz);
        const fromWd = weekdayMon0(fromLocal.Y, fromLocal.M, fromLocal.D);
        const mondayFrom = addDaysYMD(fromLocal.Y, fromLocal.M, fromLocal.D, -fromWd);

        // Compute week index offset (in local calendar days)
        const mondayBaseMs = Date.UTC(mondayBase.Y, mondayBase.M - 1, mondayBase.D);
        const mondayFromMs = Date.UTC(mondayFrom.Y, mondayFrom.M - 1, mondayFrom.D);

        let weeksDiff = Math.floor((mondayFromMs - mondayBaseMs) / (7 * DAY_MS));
        if (weeksDiff < 0) weeksDiff = 0;

        let weekIndex = Math.floor(weeksDiff / step);

        const until = Math.min(toUtc, ev.repeatUntilUtc ?? Number.POSITIVE_INFINITY);

        for (; ;) {
            const weekStart = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, weekIndex * 7 * step);

            for (const wd of list) {
                const occ = addDaysYMD(weekStart.Y, weekStart.M, weekStart.D, wd);

                const start = zonedTimeToUtcMs(occ.Y, occ.M, occ.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                if (start < from2 || start > until) continue;

                if (!push(start, out)) return out;
            }

            // stop condition: next week start beyond range
            const nextWeek = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, (weekIndex + 1) * 7 * step);
            const nextWeekStartUtc = zonedTimeToUtcMs(nextWeek.Y, nextWeek.M, nextWeek.D, 0, 0, 0, tz);
            if (nextWeekStartUtc > toUtc) break;

            weekIndex++;
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

async function pushUiSettings(joplin: any, panel: string) {
    const weekStart = await getWeekStart(joplin);
    // console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    const debug = await getDebugEnabled(joplin);

    // Main-side logger should follow the same setting
    setDebugEnabled(!!debug);

    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;
    // console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    await pm(panel, {name: 'uiSettings', weekStart, debug: !!debug});
}

// Ensure UI always receives current settings when the webview (re)initializes.
async function registerUiMessageHandlers(joplin: any, panelId: string) {
    const onMessage = (joplin as any)?.views?.panels?.onMessage;
    if (typeof onMessage !== 'function') return;

    await onMessage(panelId, async (msg: any) => {
        // Joplin sometimes wraps payload as { message: <payload> }
        if (msg && typeof msg === 'object' && 'message' in msg && (msg as any).message) {
            msg = (msg as any).message;
        }
        if (!msg || !msg.name) return;

        if (msg.name === 'uiReady') {
            await pushUiSettings(joplin, panelId);
            // Force a redraw so weekStart takes effect immediately.
            const pm = joplin?.views?.panels?.postMessage;
            if (typeof pm === 'function') {
                await pm(panelId, {name: 'redrawMonth'});
            }
            return;
        }
    });
}


export default async function runPlugin(joplin: any) {

    console.log('[MyCalendar] pluginMain: start');

    await registerSettings(joplin);

    const panel = await createCalendarPanel(joplin);
    console.log('[MyCalendar] panel id:', panel);
    await registerUiMessageHandlers(joplin, panel);


    await joplin.commands.register({
        name: 'mycalendar.open',
        label: 'Open MyCalendar',
        execute: async () => {
            await joplin.views.panels.show(panel);
            // Ensure the UI gets the latest weekStart when the panel becomes visible.
            await pushUiSettings(joplin, panel);
            try {
                const pm = joplin?.views?.panels?.postMessage;
                if (typeof pm === 'function') await pm(panel, {name: 'redrawMonth'});
            } catch {
            }
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

    await pushUiSettings(joplin, panel);

    await joplin.views.panels.show(panel);

    await joplin.settings.onChange(async () => {
        await pushUiSettings(joplin, panel);
    });

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
async function registerDesktopToggle(joplin: any, panel: string) {
    try {
        const canShow = !!joplin?.views?.panels?.show;
        const canHide = !!joplin?.views?.panels?.hide;
        const canMenu = !!joplin?.views?.menuItems?.create;

        console.info('[MyCalendar] toggle: capabilities', {canShow, canHide, canMenu, panel});

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
                    if (!panel) return;
                    if (mycalendarVisible) {
                        // on Desktop there is Hide (); on Mobile there is no - just do nothing
                        if (joplin.views?.panels?.hide) {
                            await joplin.views.panels.hide(panel);
                        }
                        mycalendarVisible = false;

                        console.log('[MyCalendar] toggle Hide');
                    } else {
                        await joplin.views.panels.show(panel);
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