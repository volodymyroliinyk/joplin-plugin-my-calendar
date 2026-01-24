// src/main/services/icsImportService.ts
// 
// tests/services/icsImportService.test.ts
//

type IcsValarm = {
    trigger: string;              // e.g. -PT1H, -P1D, -P1W, or an absolute date-time
    related?: 'START' | 'END';     // TRIGGER;RELATED=START|END
    action?: string;              // DISPLAY / AUDIO / EMAIL / ...
    description?: string;
    summary?: string;
    repeat?: number;
    duration?: string;             // e.g. PT15M
};

type IcsEvent = {
    uid?: string;
    recurrence_id?: string;

    // MyCalendar normalized fields (what we write into ```mycalendar-event``` blocks)
    title?: string;
    description?: string;
    location?: string;
    color?: string;

    start?: string; // "2025-08-12 10:00:00-04:00" or without offset (with tz)
    end?: string;
    tz?: string; // IANA tz, e.g. "America/Toronto"

    repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    repeat_interval?: number;
    repeat_until?: string;
    byweekday?: string;   // "MO,TU,WE"
    bymonthday?: string;  // "12"

    all_day?: boolean;
    valarms?: IcsValarm[];
};

function normalizeRecurrenceIdForKey(recurrenceId?: string): string {
    const v = (recurrenceId || '').trim();
    if (!v) return '';

    // Keep DATE:yyyyMMdd as-is (date-only recurrence instances)
    if (/^DATE:\d{8}$/i.test(v)) return v;

    // Backward compatible normalization:
    // - old versions stored RECURRENCE-ID as plain YYYYMMDDTHHMMSS(Z?)
    // - newer imports may store TZID:YYYYMMDDTHHMMSS(Z?)
    // For matching and dedup we treat them as the same instance.
    const tzMatch = v.match(/^[^:]+:(\d{8}T\d{6}Z?)$/);
    if (tzMatch) return tzMatch[1];

    return v;
}

function unfoldIcsLines(ics: string): string[] {
    const raw = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out: string[] = [];
    for (const line of raw) {
        if (!line) continue;
        // folded line: starts with space/tab
        if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }
    return out;
}

function unescapeIcsText(s: string): string {
    return s
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

// Take the value after ":" (ignore parameters like DTSTART;TZID=...)
function parseLineValue(line: string): { key: string; value: string; params: Record<string, string> } | null {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const left = line.slice(0, i);
    const value = line.slice(i + 1);

    const parts = left.split(';').map(p => p.trim()).filter(Boolean);
    const key = (parts[0] || '').toUpperCase();

    const params: Record<string, string> = {};
    for (let j = 1; j < parts.length; j++) {
        const p = parts[j];
        const eq = p.indexOf('=');
        if (eq > 0) {
            const k = p.slice(0, eq).toUpperCase();
            const v = p.slice(eq + 1);
            params[k] = v;
        }
    }

    return {key, value, params};
}

function icsDateToMyCalText(icsValue: string): string | undefined {
    const v = icsValue.trim();

    // YYYYMMDDTHHMMSSZ
    let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}+00:00`;

    // YYYYMMDDTHHMMSS
    m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;

    // YYYYMMDD (all-day)
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;

    // Already ISO-like -> normalize "T" to space
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.replace('T', ' ');

    return undefined;
}

function normalizeRepeatFreq(freq?: string): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined {
    if (!freq) return undefined;
    const f = freq.toLowerCase();
    if (f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'yearly') return f as any;
    return undefined;
}

function parseRRule(rrule?: string): Partial<IcsEvent> {
    if (!rrule) return {};
    const parts = rrule.split(';').map(s => s.trim()).filter(Boolean);
    const map: Record<string, string> = {};
    for (const p of parts) {
        const i = p.indexOf('=');
        if (i > 0) map[p.slice(0, i).toUpperCase()] = p.slice(i + 1);
    }

    const out: Partial<IcsEvent> = {};
    const freq = normalizeRepeatFreq(map['FREQ']);
    if (freq) out.repeat = freq;

    const interval = map['INTERVAL'] ? parseInt(map['INTERVAL'], 10) : NaN;
    if (Number.isFinite(interval) && interval >= 1) out.repeat_interval = interval;

    // UNTIL is UTC in many feeds; keep as "+00:00" when Z
    const until = map['UNTIL'] ? icsDateToMyCalText(map['UNTIL']) : undefined;
    if (until) out.repeat_until = until;

    if (map['BYDAY']) out.byweekday = map['BYDAY'].trim();
    if (map['BYMONTHDAY']) out.bymonthday = map['BYMONTHDAY'].trim();

    return out;
}

function stripInlineComment(line: string): string {
    // Remove " # comment" (but keep if # is in the middle of a value without leading whitespace)
    const i = line.indexOf('#');
    if (i < 0) return line;
    // treat as comment only if there is whitespace before '#'
    const before = line.slice(0, i);
    if (/\s$/.test(before)) return before.trimEnd();
    return line;
}

// Parses the "key: value" format (events separated by blank lines or "---")
function parseMyCalKeyValueText(text: string): IcsEvent[] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const events: IcsEvent[] = [];
    let cur: IcsEvent = {};

    const flush = () => {
        const hasAny =
            !!cur.uid || !!cur.title || !!cur.start || !!cur.end || !!cur.description || !!cur.location || !!cur.color ||
            !!cur.repeat || !!cur.byweekday || !!cur.bymonthday || !!cur.repeat_until || !!(cur.valarms && cur.valarms.length);
        if (hasAny) {
            events.push(cur);
            cur = {};
        }
    };

    for (const raw of lines) {
        const line0 = stripInlineComment(raw).trim();
        if (!line0) {
            flush();
            continue;
        }
        if (line0 === '---') {
            flush();
            continue;
        }

        const m = line0.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+)\s*$/);
        if (!m) continue;

        const k = m[1].toLowerCase();
        const v = m[2].trim();

        if (k === 'uid') cur.uid = v;
        else if (k === 'recurrence_id') cur.recurrence_id = v;
        else if (k === 'title' || k === 'summary') cur.title = v;
        else if (k === 'description') cur.description = v;
        else if (k === 'location') cur.location = v;
        else if (k === 'color') cur.color = v;

        else if (k === 'start') cur.start = v;
        else if (k === 'end') cur.end = v;
        else if (k === 'tz') cur.tz = v;

        else if (k === 'valarm') {
            // repeated lines: valarm: {json}
            try {
                const obj = JSON.parse(v);
                if (obj && typeof obj === 'object' && typeof (obj as any).trigger === 'string') {
                    (cur.valarms ??= []).push(obj as IcsValarm);
                }
            } catch {
                // ignore invalid JSON
            }
        } else if (k === 'repeat') cur.repeat = normalizeRepeatFreq(v) || 'none';
        else if (k === 'repeat_interval') {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 1) cur.repeat_interval = n;
        } else if (k === 'repeat_until') cur.repeat_until = v;
        else if (k === 'byweekday') cur.byweekday = v;
        else if (k === 'bymonthday') cur.bymonthday = v;
    }

    flush();
    return events;
}

function parseIcs(ics: string): IcsEvent[] {
    const lines = unfoldIcsLines(ics);
    const events: IcsEvent[] = [];
    let cur: IcsEvent | null = null;
    let curAlarm: IcsValarm | null = null;

    for (const line of lines) {
        const L = line.trim();
        if (!L) continue;

        if (L === 'BEGIN:VEVENT') {
            cur = {};
            curAlarm = null;
            continue;
        }
        if (L === 'END:VEVENT') {
            // If VALARM was not properly closed, drop it.
            curAlarm = null;
            if (cur) events.push(cur);
            cur = null;
            continue;
        }
        if (!cur) continue;

        if (L === 'BEGIN:VALARM') {
            curAlarm = {trigger: ''};
            continue;
        }
        if (L === 'END:VALARM') {
            if (curAlarm && curAlarm.trigger) {
                (cur.valarms ??= []).push(curAlarm);
            }
            curAlarm = null;
            continue;
        }

        const parsed = parseLineValue(L);
        if (!parsed) continue;
        const {key, value, params} = parsed;

        if (curAlarm) {
            if (key === 'TRIGGER') {
                curAlarm.trigger = value.trim();
                const rel = (params['RELATED'] || '').toUpperCase();
                if (rel === 'START' || rel === 'END') curAlarm.related = rel as any;
            } else if (key === 'ACTION') {
                curAlarm.action = value.trim();
            } else if (key === 'DESCRIPTION') {
                curAlarm.description = unescapeIcsText(value);
            } else if (key === 'SUMMARY') {
                curAlarm.summary = unescapeIcsText(value);
            } else if (key === 'REPEAT') {
                const n = parseInt(value.trim(), 10);
                if (Number.isFinite(n)) curAlarm.repeat = n;
            } else if (key === 'DURATION') {
                curAlarm.duration = value.trim();
            }
            continue;
        }

        const isDateOnly = (value: string, params: Record<string, string>) =>
            (params['VALUE'] || '').toUpperCase() === 'DATE' || /^\d{8}$/.test(value.trim());

        if (key === 'UID') cur.uid = value.trim();
        else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
        else if (key === 'DESCRIPTION') cur.description = unescapeIcsText(value);
        else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
        else if (key === 'X-COLOR') cur.color = value.trim();

        else if (key === 'DTSTART') {
            cur.start = icsDateToMyCalText(value) || value.trim();
            if (isDateOnly(value, params)) cur.all_day = true;
            if (params['TZID'] && !cur.tz) cur.tz = params['TZID'];
        } else if (key === 'DTEND') {
            cur.end = icsDateToMyCalText(value) || value.trim();
            if (isDateOnly(value, params)) cur.all_day = true;
            if (params['TZID'] && !cur.tz) cur.tz = params['TZID'];
        } else if (key === 'RRULE') {
            Object.assign(cur, parseRRule(value.trim()));
        } else if (key === 'RECURRENCE-ID') {
            const ridVal = value.trim();
            const tzid = params['TZID'];
            const valType = (params['VALUE'] || '').toUpperCase(); // DATE / DATE-TIME

            if (valType === 'DATE') {
                // e.g. RECURRENCE-ID;VALUE=DATE:20200727
                cur.recurrence_id = `DATE:${ridVal}`;
            } else if (tzid) {
                // e.g. RECURRENCE-ID;TZID=America/Toronto:20250101T090000
                cur.recurrence_id = `${tzid}:${ridVal}`;
                if (!cur.tz) cur.tz = tzid;
            } else {
                // e.g. RECURRENCE-ID:20250101T140000Z
                cur.recurrence_id = ridVal;
            }
        }
    }

    return events;
}

function parseImportText(text: string): IcsEvent[] {
    const t = text.trim();
    if (/BEGIN:VCALENDAR/i.test(t) || /BEGIN:VEVENT/i.test(t)) return parseIcs(text);
    return parseMyCalKeyValueText(text);
}

function parseIsoDurationToMs(s: string): number | null {
    // supports +/-P[nW][nD]T[nH][nM][nS]
    const t = s.trim().toUpperCase();
    const sign = t.startsWith('-') ? -1 : 1;
    const core = t.startsWith('-') || t.startsWith('+') ? t.slice(1) : t;
    const m = core.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return null;
    const w = m[1] ? parseInt(m[1], 10) : 0;
    const d = m[2] ? parseInt(m[2], 10) : 0;
    const h = m[3] ? parseInt(m[3], 10) : 0;
    const mi = m[4] ? parseInt(m[4], 10) : 0;
    const se = m[5] ? parseInt(m[5], 10) : 0;
    if (![w, d, h, mi, se].every(n => Number.isFinite(n))) return null;
    return sign * (((w * 7 + d) * 24 + h) * 60 * 60 * 1000 + mi * 60 * 1000 + se * 1000);
}

function parseMyCalDateToDate(s?: string): Date | null {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    const iso = t.replace(' ', 'T');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function formatAlarmTitleTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDays(d: Date, days: number): Date {
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + days);
    return out;
}

function addMonths(d: Date, months: number): Date {
    const out = new Date(d.getTime());
    out.setMonth(out.getMonth() + months);
    return out;
}

function addYears(d: Date, years: number): Date {
    const out = new Date(d.getTime());
    out.setFullYear(out.getFullYear() + years);
    return out;
}

function weekdayToJs(day: string): number | null {
    const d = day.toUpperCase();
    if (d === 'SU') return 0;
    if (d === 'MO') return 1;
    if (d === 'TU') return 2;
    if (d === 'WE') return 3;
    if (d === 'TH') return 4;
    if (d === 'FR') return 5;
    if (d === 'SA') return 6;
    return null;
}

type Occurrence = { start: Date; end: Date; recurrence_id?: string };

function expandOccurrences(ev: IcsEvent, windowStart: Date, windowEnd: Date): Occurrence[] {
    const start = parseMyCalDateToDate(ev.start);
    if (!start) return [];
    const end = parseMyCalDateToDate(ev.end) ?? new Date(start.getTime());
    const durMs = end.getTime() - start.getTime();

    const until = parseMyCalDateToDate(ev.repeat_until);
    const hardEnd = until && until.getTime() < windowEnd.getTime() ? until : windowEnd;

    const interval = ev.repeat_interval && ev.repeat_interval >= 1 ? ev.repeat_interval : 1;

    const occs: Occurrence[] = [];

    const pushIfInRange = (s: Date) => {
        const e = new Date(s.getTime() + durMs);
        if (s.getTime() > hardEnd.getTime()) return;
        if (e.getTime() < windowStart.getTime()) return;
        if (s.getTime() > windowEnd.getTime()) return;
        occs.push({start: s, end: e, recurrence_id: undefined});
    };

    if (!ev.repeat || ev.repeat === 'none') {
        pushIfInRange(start);
        return occs;
    }

    if (ev.repeat === 'daily') {
        let cur = new Date(start.getTime());
        while (cur.getTime() <= hardEnd.getTime()) {
            pushIfInRange(cur);
            cur = addDays(cur, interval);
        }
        return occs;
    }

    if (ev.repeat === 'weekly') {
        const days = (ev.byweekday ? ev.byweekday.split(',') : []).map(d => d.trim()).filter(Boolean);
        const jsDays = (days.length ? days : [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][start.getDay()]])
            .map(weekdayToJs)
            .filter((n): n is number => n !== null)
            .sort((a, b) => a - b);

        let weekAnchor = new Date(start.getTime());
        while (weekAnchor.getTime() <= hardEnd.getTime()) {
            for (const wd of jsDays) {
                const s = new Date(weekAnchor.getTime());
                const delta = wd - s.getDay();
                s.setDate(s.getDate() + delta);
                s.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
                if (s.getTime() < weekAnchor.getTime()) s.setDate(s.getDate() + 7);
                if (s.getTime() < start.getTime()) continue;
                pushIfInRange(s);
            }
            weekAnchor = addDays(weekAnchor, 7 * interval);
        }
        return occs;
    }

    if (ev.repeat === 'monthly') {
        let cur = new Date(start.getTime());
        const day = ev.bymonthday ? parseInt(ev.bymonthday, 10) : start.getDate();
        while (cur.getTime() <= hardEnd.getTime()) {
            const s = new Date(cur.getTime());
            s.setDate(day);
            s.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
            if (s.getTime() < start.getTime()) {
                cur = addMonths(cur, interval);
                continue;
            }
            pushIfInRange(s);
            cur = addMonths(cur, interval);
        }
        return occs;
    }

    if (ev.repeat === 'yearly') {
        let cur = new Date(start.getTime());
        while (cur.getTime() <= hardEnd.getTime()) {
            pushIfInRange(cur);
            cur = addYears(cur, interval);
        }
        return occs;
    }

    return occs;
}

function computeAlarmWhen(alarm: IcsValarm, occ: Occurrence): Date | null {
    const trig = alarm.trigger.trim();
    const abs = icsDateToMyCalText(trig);
    if (abs) return parseMyCalDateToDate(abs);
    const delta = parseIsoDurationToMs(trig);
    if (delta === null) return null;
    const base = alarm.related === 'END' ? occ.end : occ.start;
    return new Date(base.getTime() + delta);
}

function formatDateForAlarm(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}


function valarmToJsonLine(a: IcsValarm): string {
    const o: any = {};
    // stable order for tests + diffs
    o.trigger = a.trigger;
    if (a.related) o.related = a.related;
    if (a.action) o.action = a.action;
    if (a.description) o.description = a.description;
    if (a.summary) o.summary = a.summary;
    if (typeof a.repeat === 'number') o.repeat = a.repeat;
    if (a.duration) o.duration = a.duration;
    return JSON.stringify(o);
}

// Form the block ```mycalendar-event ... ``` as you have already done
function buildMyCalBlock(ev: IcsEvent): string {
    const lines: string[] = [];
    lines.push('```mycalendar-event');

    if (ev.title) lines.push(`title: ${ev.title}`);
    if (ev.start) lines.push(`start: ${ev.start}`);
    if (ev.end) lines.push(`end: ${ev.end}`);
    if (ev.tz) lines.push(`tz: ${ev.tz}`);
    if (ev.color) lines.push(`color: ${ev.color}`);
    if (ev.location) lines.push(`location: ${ev.location}`);
    if (ev.description) lines.push(`description: ${ev.description}`);

    if (ev.valarms && ev.valarms.length) {
        lines.push('');
        for (const a of ev.valarms) {
            // repeated key allows multiple alarms
            lines.push(`valarm: ${valarmToJsonLine(a)}`);
        }
    }

    const repeat = ev.repeat && ev.repeat !== 'none' ? ev.repeat : undefined;
    if (repeat) {
        lines.push('');
        lines.push(`repeat: ${repeat}`);
        lines.push(`repeat_interval: ${ev.repeat_interval ?? 1}`);
        if (ev.repeat_until) lines.push(`repeat_until: ${ev.repeat_until}`);
        if (ev.byweekday) lines.push(`byweekday: ${ev.byweekday}`);
        if (ev.bymonthday) lines.push(`bymonthday: ${ev.bymonthday}`);
    }

    if (ev.all_day) lines.push(`all_day: true`);

    if (ev.uid) {
        lines.push('');
        lines.push(`uid: ${ev.uid}`);
        if (ev.recurrence_id) {
            lines.push(`recurrence_id: ${ev.recurrence_id}`);
        }
    }

    lines.push('```');
    return lines.join('\n');
}

function makeEventKey(uid: string, recurrenceId?: string): string {
    const u = (uid || '').trim();
    const rid = normalizeRecurrenceIdForKey(recurrenceId);
    return `${u}|${rid}`;
}


function parseUidAndRecurrence(inner: string): { uid?: string; recurrence_id?: string } {
    // NOTE:
    // In alarm notes, recurrence_id can be empty: `recurrence_id: `
    // so we must allow empty matches with (.*?)
    // Fix: use [ \t] instead of \s to avoid matching newlines
    const uidM = inner.match(/^[ \t]*uid[ \t]*:[ \t]*(.*?)[ \t]*$/im);
    const ridM = inner.match(/^[ \t]*recurrence_id[ \t]*:[ \t]*(.*?)[ \t]*$/im);
    return {
        uid: uidM?.[1]?.trim() || undefined,
        recurrence_id: (ridM?.[1] ?? '').trim(),
    };
}

function extractAllAlarmKeysFromBody(body: string): { key: string; uid: string; recurrence_id: string }[] {
    const re = /(^|\r?\n)[ \t]*```mycalendar-alarm[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    const out: { key: string; uid: string; recurrence_id: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);
        if (!meta.uid) continue;
        const rid = (meta.recurrence_id ?? '').trim();
        out.push({key: makeEventKey(meta.uid, rid), uid: meta.uid, recurrence_id: rid});
    }
    return out;
}

function extractAllEventKeysFromBody(body: string): string[] {
    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    const keys: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);
        if (!meta.uid) continue;
        keys.push(makeEventKey(meta.uid, meta.recurrence_id));
    }
    return keys;
}


function replaceEventBlockByKey(
    body: string,
    uid: string,
    recurrenceId: string | undefined,
    newBlock: string,
): string {
    const targetUid = (uid || '').trim();
    const targetRid = normalizeRecurrenceIdForKey(recurrenceId);

    // Grab the block so that:
    // - prefix: either the beginning or \n before the block (but do NOT touch the text before it)
    // - the fenced-block itself
    // - suffix: everything after it remains as is
    const re =
        /(^|\r?\n)([ \t]*```mycalendar-event[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```)(?=\r?\n|$)/g;

    let changed = false;

    const out = body.replace(re, (fullMatch, prefixNL, wholeBlock) => {
        // get the "inner" part to determine the uid/recurrence_id of this particular block
        const innerM = wholeBlock.match(/^[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/);
        const inner = innerM?.[1] ?? '';

        const meta = parseUidAndRecurrence(inner);
        const u = (meta.uid || '').trim();
        // const r = (meta.recurrence_id || '').trim();
        const r = normalizeRecurrenceIdForKey(meta.recurrence_id);

        if (u !== targetUid) return fullMatch;

        // master event (recurrenceId is missing) - we change only the block without recurrence_id
        if (!targetRid) {
            if (!r) {
                changed = true;
                return `${prefixNL}${newBlock}`;
            }
            return fullMatch;
        }

        // instance/exception - recurrence_id must match
        if (r === targetRid) {
            changed = true;
            return `${prefixNL}${newBlock}`;
        }

        return fullMatch;
    });

    if (changed) return out;

    // If the block is not found, add it without touching the existing text
    const trimmed = (body || '').replace(/\s+$/, '');
    return (trimmed ? trimmed + '\n\n' : '') + newBlock + '\n';
}


function parseColor(inner: string): string | undefined {
    const m = inner.match(/^\s*color\s*:\s*(.+?)\s*$/im);
    return m?.[1]?.trim();
}

function extractEventColorFromBody(body: string, uid: string, recurrenceId?: string): string | undefined {
    const targetUid = (uid || '').trim();
    const targetRid = normalizeRecurrenceIdForKey(recurrenceId);

    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);

        const u = (meta.uid || '').trim();
        // const r = (meta.recurrence_id || '').trim();
        const r = normalizeRecurrenceIdForKey(meta.recurrence_id);

        if (u !== targetUid) continue;

        // master event
        if (!targetRid) {
            if (!r) return parseColor(inner);
            continue;
        }

        // recurrence instance
        if (r === targetRid) return parseColor(inner);
    }

    return undefined;
}

export async function importIcsIntoNotes(
    joplin: any,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    importDefaultColor?: string,
): Promise<{
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number
}> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch {
        }
    };

    const events = parseImportText(ics);
    await say(`Parsed ${events.length} VEVENT(s)`);

    // existing map uid+recurrence -> event not
    const existing: Record<string, { id: string; title: string; body: string; parent_id?: string }> = {};
    // existing alarm notes map uid+recurrence -> [alarmNoteId]
    const existingAlarms: Record<string, string[]> = {};

    let page = 1;

    while (true) {
        const res = await joplin.data.get(['notes'], {fields: ['id', 'title', 'body', 'parent_id'], limit: 100, page});

        for (const n of res.items || []) {
            if (!n.body || typeof n.body !== 'string') continue;

            if (n.body.includes('```mycalendar-event')) {
                const keys = extractAllEventKeysFromBody(n.body);
                for (const k of keys) {
                    existing[k] = {id: n.id, title: n.title || '', body: n.body, parent_id: n.parent_id};
                }
            }

            if (n.body.includes('```mycalendar-alarm')) {
                const metas = extractAllAlarmKeysFromBody(n.body);
                for (const meta of metas) {
                    (existingAlarms[meta.key] ??= []).push(n.id);
                }
            }
        }

        if (!res.has_more) break;
        page++;
    }

    let added = 0, updated = 0, skipped = 0, errors = 0;

    const importedEventNotes: Record<string, { id: string; parent_id?: string; title: string }> = {};

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) {
            skipped++;
            continue;
        }

        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);


        if (preserveLocalColor && existing[key] && !ev.color) {
            const existingColor = extractEventColorFromBody(existing[key].body, uid, rid);
            if (existingColor) ev.color = existingColor;
        }

        // 2) apply default import color if still missing
        if (!ev.color && importDefaultColor) {
            ev.color = importDefaultColor;
        }

        const block = buildMyCalBlock(ev);
        const desiredTitle = ev.title || 'Event';

        if (existing[key]) {
            try {
                const {id, body, title, parent_id} = existing[key];

                const newBody = replaceEventBlockByKey(body, uid, rid, block);

                const patch: any = {};
                if (newBody !== body) patch.body = newBody;
                if (desiredTitle !== title) patch.title = desiredTitle;

                // If user selected another notebook for this import, move existing note as well.
                if (targetFolderId && parent_id !== targetFolderId) patch.parent_id = targetFolderId;

                if (Object.keys(patch).length > 0) {
                    await joplin.data.put(['notes', id], null, patch);
                    updated++;
                } else {
                    skipped++;
                }

                importedEventNotes[key] = {id, parent_id: (targetFolderId || parent_id), title: desiredTitle};

            } catch (e) {
                errors++;
                await say(`ERROR update: ${key} - ${String((e as any)?.message || e)}`);
            }
        } else {
            try {
                const noteBody: any = {title: desiredTitle, body: block};
                if (targetFolderId) noteBody.parent_id = targetFolderId;

                const created = await joplin.data.post(['notes'], null, noteBody);
                added++;
                if (created && created.id) importedEventNotes[key] = {
                    id: created.id,
                    parent_id: targetFolderId,
                    title: desiredTitle
                };

            } catch (e) {
                errors++;
                await say(`ERROR create: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    // Stage 2: (re)generate todo+alarm notes from VALARM for the next 30 days
    const now = new Date();
    const windowEnd = addDays(now, 30);

    let alarmsDeleted = 0;
    let alarmsCreated = 0

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) continue;
        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        const eventNote = importedEventNotes[key] ?? existing[key];
        if (!eventNote) continue;

        const notebookId = targetFolderId || eventNote.parent_id;
        if (!notebookId) continue;

        // delete old alarms for this event (if any)
        const oldAlarmIds = existingAlarms[key] || [];
        for (const alarmId of oldAlarmIds) {
            try {
                // @ts-ignore - joplin.data.delete exists at runtime
                await joplin.data.delete(['notes', alarmId]);
                alarmsDeleted++;
            } catch (e) {
                await say(`ERROR delete alarm: ${key} - ${String((e as any)?.message || e)}`);
            }
        }

        if (!ev.valarms || !ev.valarms.length) continue;

        const occs = expandOccurrences(ev, now, windowEnd);

        for (const occ of occs) {
            for (const a of ev.valarms) {
                const when = computeAlarmWhen(a, occ);
                if (!when) continue;

                const whenMs = when.getTime();
                if (whenMs < now.getTime()) continue;
                if (whenMs > windowEnd.getTime()) continue;

                const titleTime = formatAlarmTitleTime(when);
                const todoTitle = `${(ev.title || 'Event')} + ${titleTime}`;

                const body = [
                    '```mycalendar-alarm',
                    `title: ${todoTitle}`,
                    `uid: ${uid}`,
                    `recurrence_id: ${rid}`,
                    `when: ${formatDateForAlarm(new Date(whenMs))}`,
                    '```',
                    '',
                    '---',
                    '',
                    `[${ev.title || 'Event'}](:/${eventNote.id})`,
                    '',
                ].join('\n');

                try {
                    const noteBody: any = {
                        title: todoTitle,
                        body,
                        parent_id: notebookId,
                        is_todo: 1,
                        alarm_time: whenMs,
                    };

                    await joplin.data.post(['notes'], null, noteBody);
                    alarmsCreated++;
                } catch (e) {
                    await say(`ERROR create alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
            }
        }
    }

    if (alarmsDeleted || alarmsCreated) {
        await say(`Alarms: deleted ${alarmsDeleted}, created ${alarmsCreated} (next 30 days)`);
    }


    return {added, updated, skipped, errors, alarmsCreated, alarmsDeleted};
}
