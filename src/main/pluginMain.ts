import joplin from 'api';
import { createCalendarPanel } from '../calendarView';
import { parseEventsFromBody, EventInput } from '../eventParser';

const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;
let rebuilding = false;

async function rebuildAllEventsCache() {
    if (rebuilding) return;
    rebuilding = true;
    try {
        console.log('[MyCalendar] rebuildAllEventsCache: start');
        const fields = ['id', 'title', 'body'];
        const items: any[] = [];
        let page = 1;
        eventCacheByNote.clear();

        while (true) {
            const res = await joplin.data.get(['notes'], { fields, page, limit: 100 });
            items.push(...res.items);
            if (!res.has_more) break;
            page++;
        }

        for (const n of items) {
            const arr = parseEventsFromBody(n.id, n.title, n.body || '');
            if (arr.length) eventCacheByNote.set(n.id, arr);
        }
        allEventsCache = Array.from(eventCacheByNote.values()).flat();
        console.log('[MyCalendar] rebuildAllEventsCache: done, events =', allEventsCache.length);
    } catch (err) {
        console.error('[MyCalendar] rebuildAllEventsCache: error', err);
    } finally {
        rebuilding = false;
    }
}

async function ensureAllEventsCache() {
    if (!allEventsCache) {
        await rebuildAllEventsCache();
    }
    return allEventsCache!;
}

function invalidateNote(noteId: string) {
    console.log('[MyCalendar] invalidateNote', noteId);
    eventCacheByNote.delete(noteId);
    allEventsCache = null;
}

// ==== розгортання повторень (без змін) ====
const DAY_MS = 24 * 60 * 60 * 1000;
type Occurrence = EventInput & { occurrenceId: string; startUtc: number; endUtc?: number };

function expandOccurrencesInRange(ev: EventInput, fromUtc: number, toUtc: number): Occurrence[] {
    const dur = (ev.endUtc ?? ev.startUtc) - ev.startUtc;
    const push = (start: number, out: Occurrence[]) => {
        if (start > toUtc) return false;
        const end = dur ? start + dur : start;
        if (end < fromUtc) return true;
        out.push({ ...ev, occurrenceId: `${ev.id}#${start}`, startUtc: start, endUtc: dur ? end : undefined });
        return true;
    };

    if (ev.repeat === 'none') {
        const end = ev.endUtc ?? ev.startUtc;
        if (end < fromUtc || ev.startUtc > toUtc) return [];
        return [{ ...ev, occurrenceId: `${ev.id}#${ev.startUtc}` }];
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
        for (;; k++) {
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

        for (;; weekIndex++) {
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
        while (cursor < ev.startUtc) { m += 1; cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS); }
        for (;;) {
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
        while (cursor < ev.startUtc) { y += 1; cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS); }
        while (cursor < fromUtc) { y += (step || 1); cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS); }
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

// ===== onStart =====
export default async function runPlugin(_j = joplin) {
    await _j.plugins.register({
        onStart: async () => {
            console.log('[MyCalendar] onStart');

            // (A) Спеціальний розділ у Settings → Options
            try {
                await _j.settings.registerSection('mycalendar.section', {
                    label: 'MyCalendar',
                    iconName: 'icon-calendar',
                });
                await _j.settings.registerSettings({
                    'mycalendar.enabled': {
                        value: true,
                        type: 3, // Bool
                        section: 'mycalendar.section',
                        public: true,
                        label: 'Enable MyCalendar',
                        description: 'If disabled, the panel will not be shown automatically.'
                    },
                });
                console.log('[MyCalendar] settings section registered');
            } catch (e) {
                console.warn('[MyCalendar] settings register failed', e);
            }

            // (B) Спробуємо створити тестову нотатку разово
            try {
                const bootNoteTitle = 'MyCalendar boot OK';
                const bootNoteBody = [
                    'This note is created by MyCalendar onStart.',
                    '',
                    '```event',
                    'calendar: my-calendar-plugin',
                    'title: Boot Event',
                    'start: 2025-08-20 10:00:00-04:00',
                    'end:   2025-08-20 11:00:00-04:00',
                    'tz: America/Toronto',
                    'color: #FF8800',
                    '```',
                ].join('\n');

                // Перевіримо, чи вже є така нотатка, щоб не плодити
                const search = await _j.data.get(['search'], { query: `"${bootNoteTitle}"`, type: 'note', limit: 1 });
                if (!search.items || !search.items.length) {
                    const created = await _j.data.post(['notes'], { title: bootNoteTitle, body: bootNoteBody });
                    console.log('[MyCalendar] boot note created:', created?.id);
                } else {
                    console.log('[MyCalendar] boot note exists');
                }
            } catch (e) {
                console.warn('[MyCalendar] boot note create failed', e);
            }

            // (C) Створюємо панель (поки мінімальний HTML)
            const panel = await createCalendarPanel();
            console.log('[MyCalendar] panel id:', panel);

            // (D) Команда для ручного показу панелі
            await _j.commands.register({
                name: 'mycalendar.open',
                label: 'Open MyCalendar',
                execute: async () => {
                    console.log('[MyCalendar] command: open');
                    await _j.views.panels.show(panel);
                    await _j.views.panels.focus(panel);
                },
            });
            console.log('[MyCalendar] command registered');

            // (E) Кешування подій
            try {
                const all = await ensureAllEventsCache();
                console.log('[MyCalendar] events cached:', all.length);
            } catch (err) {
                console.error('[MyCalendar] ensureAllEventsCache error:', err);
            }

            // (F) Тригери та повідомлення з webview (без змін)
            await _j.workspace.onNoteChange(async ({ id }: { id?: string }) => {
                if (id) invalidateNote(id);
            });
            await _j.workspace.onSyncComplete(async () => {
                allEventsCache = null;
            });

            await _j.views.panels.onMessage(panel, async (msg: any) => {
                try {
                    if (msg.name === 'requestRangeEvents') {
                        const all = await ensureAllEventsCache();
                        const list = expandAllInRange(all, msg.fromUtc, msg.toUtc);
                        await _j.views.panels.postMessage(panel, { name: 'rangeEvents', events: list });
                    } else if (msg.name === 'dateClick') {
                        const dayStart = msg.dateUtc;
                        const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;
                        const all = await ensureAllEventsCache();
                        const list = expandAllInRange(all, dayStart, dayEnd)
                            .filter(e => e.startUtc >= dayStart && e.startUtc <= dayEnd);
                        await _j.views.panels.postMessage(panel, { name: 'showEvents', dateUtc: msg.dateUtc, events: list });
                    } else if (msg.name === 'openNote' && msg.id) {
                        await _j.commands.execute('openNote', msg.id);
                    } else if (msg.name === 'exportRangeIcs'
                        && typeof msg.fromUtc === 'number'
                        && typeof msg.toUtc === 'number') {
                        const all = await ensureAllEventsCache();
                        const list = expandAllInRange(all, msg.fromUtc, msg.toUtc);
                        const ics = buildICS(list);
                        await _j.views.panels.postMessage(panel, {
                            name: 'rangeIcs',
                            ics,
                            filename: `mycalendar_${new Date(msg.fromUtc).toISOString().slice(0, 10)}_${new Date(msg.toUtc).toISOString().slice(0, 10)}.ics`,
                        });
                    }
                } catch (e) {
                    console.error('[MyCalendar] onMessage error:', e);
                }
            });

            // (G) Автопоказ панелі
            await _j.views.panels.show(panel);
            await _j.views.panels.focus(panel);
            console.log('[MyCalendar] panel show+focus');
        },
    });
}


// ===== .ICS EXPORT (без змін) =====
function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtICS(tsUtc: number) {
    const d = new Date(tsUtc);
    return d.getUTCFullYear().toString() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
        'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}
function icsEscape(s: string) { return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
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
        if (ev.desc) lines.push(`DESCRIPTION:${icsEscape(ev.desc)}`);
        if (ev.color) lines.push(`X-COLOR:${icsEscape(ev.color)}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}
