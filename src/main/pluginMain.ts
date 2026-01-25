// src/main/pluginMain.ts

import {createCalendarPanel} from './views/calendarView';
import {EventInput} from './parsers/eventParser';

import {ensureAllEventsCache, invalidateNote, invalidateAllEventsCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';
import {registerSettings} from './settings/settings';
import {pushUiSettings} from "./uiBridge/uiSettings";
import {
    Occurrence,
    parseYmdHmsLocal,
    addDaysYMD,
    weekdayMon0,
    getPartsInTz,
    zonedTimeToUtcMs,
    DAY_MS
} from './utils/dateUtils';

import {dbg, err, info, log, warn} from './utils/logger';

function expandOccurrencesInRange(ev: EventInput, fromUtc: number, toUtc: number): Occurrence[] {
    // Invariant: recurring events must have timezone
    const tz = ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (ev.repeat !== 'none' && !ev.tz) {
        warn('recurring event has no tz; using device tz:', tz, ev.title, ev.id);
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
        const y = baseY;
        let m = baseM;
        let cursor = Date.UTC(y, m, dom, baseH, baseMin, baseS);
        while (cursor < ev.startUtc) {
            m += 1;
            cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS);
        }
        for (; ;) {
            if (cursor > until) break;
            const cd = new Date(cursor);
            // Ensure month is what we expect (no overflow like Jan 31 -> Feb 3)
            const expectedM = (m % 12 + 12) % 12;
            if (cd.getUTCMonth() === expectedM) {
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
            // Ensure month is still February (or whatever baseM was) - handles Leap Year Feb 29
            if (dt.getUTCMonth() === baseM) {
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

function getPanelsAny(joplin: any) {
    return (joplin as any)?.views?.panels;
}

async function safePostMessage(joplin: any, panelId: string, message: unknown): Promise<void> {
    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm === 'function') await pm(panelId, message);
}

// Ensure UI always receives current settings when the webview (re)initializes.
async function registerUiMessageHandlers(joplin: any, panelId: string) {
    const onMessage = getPanelsAny(joplin)?.onMessage;
    if (typeof onMessage !== 'function') return;

    await onMessage(panelId, async (msg: any) => {
        // Joplin sometimes wraps payload as { message: <payload> }
        if (msg && typeof msg === 'object' && 'message' in msg && (msg as any).message) {
            msg = (msg as any).message;
        }
        if (!msg || !msg.name) return;

        if (msg.name === 'uiLog') {
            const source = msg.source ? `[UI:${msg.source}]` : '[UI]';
            const level = msg.level || 'log';
            const args = Array.isArray(msg.args) ? msg.args : [];

            const restored = args.map((a: any) => {
                if (a && typeof a === 'object' && a.__error) {
                    const e = new Error(a.message || 'UI error');
                    (e as any).stack = a.stack;
                    return e;
                }
                return a;
            });

            switch (level) {
                case 'debug':
                    dbg(source, ...restored);
                    break;
                case 'info':
                    info(source, ...restored);
                    break;
                case 'warn':
                    warn(source, ...restored);
                    break;
                case 'error':
                    err(source, ...restored);
                    break;
                default:
                    log(source, ...restored);
                    break;
            }
            return;
        }

        if (msg.name === 'uiReady') {
            await pushUiSettings(joplin, panelId);
            // Force a redraw so weekStart takes effect immediately.
            // const pm = joplin?.views?.panels?.postMessage;
            // if (typeof pm === 'function') {
            //     await pm(panelId, {name: 'redrawMonth'});
            // }
            await safePostMessage(joplin, panelId, {name: 'redrawMonth'})
            return;
        }
    });
}


export default async function runPlugin(joplin: any) {

    log('pluginMain: start');

    await registerSettings(joplin);

    const panel = await createCalendarPanel(joplin);
    log('panel id:', panel);
    await registerUiMessageHandlers(joplin, panel);

    await registerCalendarPanelController(joplin, panel, {
        expandAllInRange,
        buildICS,
    });

    await joplin.commands.register({
        name: 'mycalendar.open',
        label: 'Open MyCalendar',
        execute: async () => {
            await joplin.views.panels.show(panel);
            // Ensure the UI gets the latest weekStart when the panel becomes visible.
            await pushUiSettings(joplin, panel);
            try {
                // const pm = joplin?.views?.panels?.postMessage;
                // if (typeof pm === 'function') await pm(panel, {name: 'redrawMonth'});
                await safePostMessage(joplin, panel, {name: 'redrawMonth'});
            } catch (_err) {
                // ignore
            }
            try {
                const panelsAny = (joplin as any).views?.panels;
                if (panelsAny && typeof panelsAny.focus === 'function') {
                    await panelsAny.focus(panel);
                }
            } catch {
                // The mobile method is missing - it's expected
                log('panels.focus not available on this platform');
            }
        },
    });


    await joplin.workspace.onNoteChange(async ({id}: { id?: string }) => {
        if (id) invalidateNote(id);
    });

    await joplin.workspace.onSyncComplete(async () => {
        invalidateAllEventsCache();
    });

    // warm up the cache after the UI already has handlers
    void (async () => {
        try {
            const all = await ensureAllEventsCache(joplin);
            log('events cached:', all.length);
        } catch (error) {
            err('ensureAllEventsCache error:', error);
        }
    })();

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
    } catch {
        // On mobile this method may be missing - it's expected
        log('panels.focus not available on this platform');
    }
}

// === MyCalendar: safe desktop toggle helper ===
async function registerDesktopToggle(joplin: any, panel: string) {
    try {
        const canShow = !!joplin?.views?.panels?.show;
        const canHide = !!joplin?.views?.panels?.hide;
        const canMenu = !!joplin?.views?.menuItems?.create;

        info('toggle: capabilities', {canShow, canHide, canMenu, panel});

        if (!canShow || !canHide) {
            info('toggle: panels.show/hide not available - skip');
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

                        log('toggle Hide');
                    } else {
                        await joplin.views.panels.show(panel);
                        // We do not call Focus () - on Mobile of this method there is no → were errors in the lounges
                        mycalendarVisible = true;
                        log('toggle Show');
                    }
                } catch (e) {
                    warn('toggle error', e);
                }
            },
        });

        try {
            await joplin.views.menuItems.create(
                'mycalendarToggleMenu',
                'mycalendar.togglePanel',
                'view'
            );
            log('toggle menu item registered');
        } catch (e) {
            warn('menu create failed (non-fatal):', e);
        }

    } catch (e) {
        warn('registerDesktopToggle failed (non-fatal):', e);
    }
}