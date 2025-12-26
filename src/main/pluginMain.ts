// src/main/pluginMain.ts
import {createCalendarPanel} from '../calendarView';
import {EventInput} from '../eventParser';

import {ensureAllEventsCache, invalidateNote, invalidateAllEventsCache} from './services/eventsCache';
import {importIcsIntoNotes} from './services/icsImportService';
import {registerCalendarPanelController} from './uiBridge/panelController';


const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;
let rebuilding = false;
let importPanelId: string | null = null;


type VeEvent = {
    UID?: string;
    SUMMARY?: string;
    DESCRIPTION?: string;
    DTSTART?: string;
    DTEND?: string;
    LOCATION?: string;
    'X-COLOR'?: string;
    RRULE?: string;
    TZID?: string; // з параметра на DTSTART/DTEND
};

function parseRRule(rr: string): Partial<{
    freq: string;
    interval: number;
    until?: string;
    byday?: string[];
    bymonthday?: number;
}> {
    const m: any = {};
    for (const part of rr.split(';')) {
        const [k, v] = part.split('=');
        if (!k || v == null) continue;
        const K = k.toUpperCase();
        if (K === 'FREQ') m.freq = v.toLowerCase();          // daily|weekly|monthly|yearly
        if (K === 'INTERVAL') m.interval = parseInt(v, 10) || 1;
        if (K === 'UNTIL') m.until = v;
        if (K === 'BYDAY') m.byday = v.split(',').map(s => s.trim()).filter(Boolean);
        if (K === 'BYMONTHDAY') m.bymonthday = parseInt(v, 10);
    }
    return m;
}

function icsDateToNoteParts(value: string, tzid?: string): { dateTime: string; tz?: string } {
    // Підтримка форм: 20250818T090000Z, 20250818T090000, 20250818
    // Для нотатки краще "YYYY-MM-DD HH:mm:ss±HH:MM" або "YYYY-MM-DD HH:mm:ss" + tz:
    const z = /Z$/.test(value);
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return {dateTime: value, tz: tzid};
    const [, Y, Mo, D, , h = '00', mi = '00', s = '00'] = m;
    const base = `${Y}-${Mo}-${D} ${h}:${mi}:${s}`;
    if (z) return {dateTime: `${base}+00:00`};
    return tzid ? {dateTime: base, tz: tzid} : {dateTime: base};
}

function veventToMyCalendarBlock(v: VeEvent): { title: string; body: string } {
    const uid = v.UID || '';
    const sum = v.SUMMARY || '(untitled)';
    const {dateTime: startText, tz: tzStart} = icsDateToNoteParts(v.DTSTART || '', v.TZID);
    const {dateTime: endText, tz: tzEnd} = v.DTEND ? icsDateToNoteParts(v.DTEND, v.TZID) : {dateTime: ''};

    // RRULE → repeat*
    let repeat = 'none';
    let repeat_interval = 1;
    let repeat_until = '';
    let byweekday = '';
    let bymonthday: number | '' = '';

    if (v.RRULE) {
        const r = parseRRule(v.RRULE);
        if (r.freq) repeat = r.freq; // daily|weekly|monthly|yearly
        if (r.interval) repeat_interval = r.interval;
        if (r.until) repeat_until = r.until; // ми дозволимо у вихідному форматі - парсер уже вміє
        if (r.byday && r.byday.length) byweekday = r.byday.join(',');
        if (typeof r.bymonthday === 'number') bymonthday = r.bymonthday;
    }

    const lines: string[] = [];
    lines.push('```mycalendar-event');
    lines.push(`uid: ${uid}`);
    lines.push(`title: ${sum}`);
    if (v.DESCRIPTION) lines.push(`description: ${v.DESCRIPTION}`);
    if (v['X-COLOR']) lines.push(`color: ${v['X-COLOR']}`);
    if (tzStart) lines.push(`tz: ${tzStart}`);
    lines.push(`start: ${startText}`);
    if (endText) lines.push(`end:   ${endText}`);

    if (repeat !== 'none') {
        lines.push(`repeat: ${repeat}`);
        if (repeat_interval) lines.push(`repeat_interval: ${repeat_interval}`);
        if (repeat_until) lines.push(`repeat_until: ${repeat_until}`);
        if (byweekday) lines.push(`byweekday: ${byweekday}`);
        if (bymonthday !== '') lines.push(`bymonthday: ${bymonthday}`);
    }
    lines.push('```');

    return {title: sum, body: lines.join('\n')};
}

function parseIcsToVevents(ics: string): VeEvent[] {
    const lines = unfoldIcsLines(ics);
    const events: VeEvent[] = [];
    let cur: VeEvent | null = null;

    for (const line of lines) {
        const L = line.trim();
        if (!L) continue;
        if (L === 'BEGIN:VEVENT') {
            cur = {};
            continue;
        }
        if (L === 'END:VEVENT') {
            if (cur) events.push(cur);
            cur = null;
            continue;
        }
        if (!cur) continue;

        // Ключ;параметри:значення
        const kv = L.split(':');
        if (kv.length < 2) continue;
        const keyAndParams = kv.shift()!;
        const value = kv.join(':'); // якщо ":" всередині - зберігаємо

        const [keyRaw, ...params] = keyAndParams.split(';');
        const key = keyRaw.toUpperCase();

        // TZID параметр на DTSTART/DTEND
        let tzid: string | undefined;
        for (const p of params) {
            const [pk, pv] = p.split('=');
            if (pk && pv && pk.toUpperCase() === 'TZID') tzid = pv;
        }

        if (key === 'DTSTART' || key === 'DTEND') {
            (cur as any)[key] = value;
            if (tzid) (cur as any)['TZID'] = tzid;
        } else {
            (cur as any)[key] = value;
        }
    }

    return events;
}

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

    // --- Створюємо панель імпорту (десктоп)

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

async function findNoteByUid(joplin: any, uid: string): Promise<any | null> {
    if (!uid) return null;
    // Шукаємо по тексту (тіло нотатки індексується)
    const q = `"uid: ${uid}"`;
    const res = await joplin.data.get(['search'], {query: q, type: 'note', limit: 1, page: 1});
    return (res && res.items && res.items[0]) ? res.items[0] : null;
}

async function currentFolderId(joplin: any): Promise<string | null> {
    try {
        const f = await joplin.workspace.selectedFolder();
        return f?.id || null;
    } catch {
        return null;
    }
}

async function runIcsImport(joplin: any, icsText: string): Promise<{
    created: number;
    updated: number;
    failed: number;
}> {
    const vevents = parseIcsToVevents(icsText || '');
    let created = 0, updated = 0, failed = 0;

    const parent = await currentFolderId(joplin);
    for (const v of vevents) {
        try {
            const block = veventToMyCalendarBlock(v);
            const existing = await findNoteByUid(joplin, v.UID || '');
            if (existing) {
                // оновлюємо: перезаписуємо body повністю (можна зробити обережне оновлення - за бажанням)
                await joplin.data.put(['notes', existing.id], null, {title: block.title, body: block.body});
                updated++;
            } else {
                await joplin.data.post(['notes'], null, {
                    title: block.title,
                    body: block.body,
                    parent_id: parent || undefined
                });
                created++;
            }
        } catch (e) {
            failed++;
            console.error('[MyCalendar] ICS import error per VEVENT:', e);
        }
    }

    // Попросимо календар перечитати кеш, щоб одразу підтягувався новий/оновлений івент
    try {
        // якщо у тебе вже є функція інвалідації/ребілду кешу - виклич її тут
        // напр. set l=null; чи rebuildAllEventsCache(); (залишаю як коментар)
        // await ensureAllEventsCache(); // або твоя існуюча логіка
    } catch {
    }

    return {created, updated, failed};
}


type IcsEvent = {
    uid?: string;
    summary?: string;
    description?: string;
    dtstart?: string;     // ISO-like or raw ICS datetime
    dtend?: string;
    tzidStart?: string;   // TZID param if present on DTSTART
    tzidEnd?: string;     // TZID param if present on DTEND
    rrule?: Record<string, string | string[]>;
    color?: string;       // optional: X-COLOR or CATEGORY => color (best-effort)
};

function unfoldIcsLines(ics: string): string[] {
    // RFC5545 folding: CRLF + space/tab -> continuation
    const raw = ics.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    for (const line of raw) {
        if (!line) {
            out.push('');
            continue;
        }
        if (/^[ \t]/.test(line) && out.length) {
            out[out.length - 1] += line.slice(1); // append continuation
        } else {
            out.push(line);
        }
    }
    return out;
}

function parseIcs(ics: string): IcsEvent[] {
    const lines = unfoldIcsLines(ics);
    const events: IcsEvent[] = [];
    let cur: IcsEvent | null = null;

    const push = () => {
        if (cur) events.push(cur);
        cur = null;
    };

    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') {
            cur = {};
            continue;
        }
        if (line === 'END:VEVENT') {
            push();
            continue;
        }
        if (!cur) continue;

        // Split "PROP;PARAMS:VALUE"
        const m = line.match(/^([A-Z0-9\-]+)(;[^:]+)?:([\s\S]*)$/i);
        if (!m) continue;
        const prop = m[1].toUpperCase();
        const params = (m[2] || '');
        const value = m[3] || '';

        const getParam = (name: string) => {
            const mm = params.match(new RegExp(`;${name}=([^;:]+)`, 'i'));
            return mm ? mm[1] : undefined;
        };

        if (prop === 'UID') {
            cur.uid = value.trim();
        } else if (prop === 'SUMMARY') {
            cur.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
        } else if (prop === 'DESCRIPTION') {
            cur.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
        } else if (prop === 'DTSTART') {
            cur.tzidStart = getParam('TZID');
            cur.dtstart = value.trim();
        } else if (prop === 'DTEND') {
            cur.tzidEnd = getParam('TZID');
            cur.dtend = value.trim();
        } else if (prop === 'RRULE') {
            const parts = value.split(';').map(s => s.trim()).filter(Boolean);
            const r: Record<string, string | string[]> = {};
            for (const p of parts) {
                const [k, v] = p.split('=');
                if (!k || v == null) continue;
                const kk = k.toUpperCase();
                if (kk === 'BYDAY' || kk === 'BYMONTHDAY') r[kk] = v.split(',').map(s => s.trim());
                else r[kk] = v;
            }
            cur.rrule = r;
        } else if (prop === 'X-COLOR') {
            cur.color = value.trim();
        }
    }

    return events;
}

function icsDateTimeToText(dt: string, tzid?: string): { text: string, tz?: string } {
    // dt formats: 20250812T150000Z / 20250812T150000 / 20250812 (date-only)
    // We will output "YYYY-MM-DD HH:mm:ss±HH:MM" and keep tz if provided
    // - Z => UTC; localize by Intl if tzid present
    const zulu = /Z$/i.test(dt);
    const dateOnly = /^\d{8}$/.test(dt);
    let d: Date;

    if (dateOnly) {
        // treat as local midnight of that date (no TZ offset in ICS)
        const y = +dt.slice(0, 4), m = +dt.slice(4, 6) - 1, da = +dt.slice(6, 8);
        d = new Date(Date.UTC(y, m, da, 0, 0, 0));
    } else {
        const y = +dt.slice(0, 4), m = +dt.slice(4, 6) - 1, da = +dt.slice(6, 8);
        const hh = +dt.slice(9, 11), mm = +dt.slice(11, 13), ss = +dt.slice(13, 15);
        if (zulu) {
            d = new Date(Date.UTC(y, m, da, hh, mm, ss));
        } else {
            // naive local; if tzid supplied, format as that timezone
            d = new Date(y, m, da, hh, mm, ss);
        }
    }

    const fmt = (n: number, w = 2) => String(n).padStart(w, '0');

    if (tzid) {
        // Format as that timezone, but our event syntax expects wall time text + we add tz: line.
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tzid,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).formatToParts(d).reduce((o, p) => {
            if (p.type !== 'literal') o[p.type] = p.value;
            return o;
        }, {} as any);
        const text = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
        return {text, tz: tzid};
    } else {
        // Format in local timezone with numeric offset
        const pad = (n: number) => String(n).padStart(2, '0');
        const y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
        const hh = d.getHours(), mi = d.getMinutes(), ss = d.getSeconds();
        const offMin = -d.getTimezoneOffset(); // minutes east of UTC
        const sign = offMin >= 0 ? '+' : '-';
        const abs = Math.abs(offMin);
        const off = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
        const text = `${y}-${pad(mo)}-${pad(da)} ${pad(hh)}:${pad(mi)}:${pad(ss)}${off}`;
        return {text};
    }
}

function rruleToMyCalendar(rr?: Record<string, string | string[]>): {
    repeat?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none';
    repeat_interval?: number;
    repeat_until?: string;
    byweekday?: string[];
    bymonthday?: number;
} {
    if (!rr) return {};
    const out: any = {};
    const freq = String(rr['FREQ'] || '').toUpperCase();
    if (freq === 'DAILY') out.repeat = 'daily';
    else if (freq === 'WEEKLY') out.repeat = 'weekly';
    else if (freq === 'MONTHLY') out.repeat = 'monthly';
    else if (freq === 'YEARLY') out.repeat = 'yearly';
    if (!out.repeat) return {};

    const iv = Number(rr['INTERVAL'] || 1);
    if (Number.isFinite(iv) && iv >= 1) out.repeat_interval = iv;

    const until = rr['UNTIL'];
    if (typeof until === 'string' && until) {
        const {text} = icsDateTimeToText(until);
        out.repeat_until = text;
    }

    if (Array.isArray(rr['BYDAY']) && rr['BYDAY'].length) {
        // Map iCal BYDAY (MO,TU,...) to our byweekday
        out.byweekday = rr['BYDAY'].map((d: any) => String(d).toUpperCase());
    }
    if (Array.isArray(rr['BYMONTHDAY']) && rr['BYMONTHDAY'].length) {
        const n = Number(rr['BYMONTHDAY'][0]);
        if (Number.isFinite(n)) out.bymonthday = n;
    }
    return out;
}

function buildMyCalBlock(e: IcsEvent): string {
    const start = icsDateTimeToText(e.dtstart || '');
    const end = e.dtend ? icsDateTimeToText(e.dtend, e.tzidEnd) : null;
    const r = rruleToMyCalendar(e.rrule);

    const lines: string[] = [];
    lines.push('```mycalendar-event');
    if (e.uid) lines.push(`uid: ${e.uid}`);
    if (e.summary) lines.push(`title: ${e.summary}`);
    if (start.text) lines.push(`start: ${start.text}`);
    if (end && end.text) lines.push(`end:   ${end.text}`);
    if (start.tz) lines.push(`tz:    ${start.tz}`);
    if (e.color) lines.push(`color: ${e.color}`);
    if (e.description) {
        // Багаторядковий description - ок
        for (const [i, row] of e.description.split('\n').entries()) {
            lines.push(i === 0 ? `description:  ${row}` : `       ${row}`);
        }
    }
    if (r.repeat) {
        lines.push(`repeat: ${r.repeat}`);
        if (r.repeat_interval) lines.push(`repeat_interval: ${r.repeat_interval}`);
        if (r.repeat_until) lines.push(`repeat_until: ${r.repeat_until}`);
        if (r.byweekday) lines.push(`byweekday: ${r.byweekday.join(',')}`);
        if (r.bymonthday) lines.push(`bymonthday: ${r.bymonthday}`);
    }
    lines.push('```');
    return lines.join('\n');
}


function replaceEventBlockByUid(body: string, uid: string, newBlock: string): string {
    // спробуємо точково замінити блок, який містить цей uid
    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let changed = false;
    const out = body.replace(re, (full, p1, inner) => {
        if (new RegExp(`^\\s*uid:\\s*${escapeReg(uid)}\\s*$`, 'im').test(inner)) {
            changed = true;
            return `${p1}${newBlock}`;
        }
        return full;
    });
    if (changed) return out;

    // Якщо не знайшли - додамо наприкінці
    return (body ? (body.replace(/\s+$/, '') + '\n\n') : '') + newBlock + '\n';
}

function escapeReg(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


