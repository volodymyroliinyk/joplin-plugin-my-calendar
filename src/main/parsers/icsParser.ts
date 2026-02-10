// src/main/parsers/icsParser.ts

import {IcsEvent, IcsValarm} from '../types/icsTypes';
import {icsDateToMyCalText} from '../utils/dateTimeUtils';

export function unfoldIcsLines(ics: string): string[] {
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

export function unescapeIcsText(s: string): string {
    // Protect escaped backslashes first, so "\\\\n" becomes literal "\n" not newline.
    const BS = '\u0000';
    return s
        .replace(/\\\\/g, BS)
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(new RegExp(BS, 'g'), '\\');
}

export function parseLineValue(line: string): { key: string; value: string; params: Record<string, string> } | null {
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
            let v = p.slice(eq + 1).trim();
            // strip optional quotes: TZID="America/Toronto"
            if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
            params[k] = v;
        }
    }

    return {key, value, params};
}

export function normalizeRepeatFreq(freq?: string): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined {
    if (!freq) return undefined;
    const f = freq.toLowerCase();
    if (f === 'none') return 'none';
    if (f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'yearly') return f as any;
    return undefined;
}

function hasMeaningfulEvent(ev: IcsEvent): boolean {
    return !!(
        ev.uid ||
        ev.title ||
        ev.start ||
        ev.end ||
        ev.description ||
        ev.location ||
        ev.color ||
        ev.repeat ||
        ev.byweekday ||
        ev.bymonthday ||
        ev.repeat_until ||
        (ev.valarms && ev.valarms.length)
    );
}

export function parseRRule(rrule?: string): Partial<IcsEvent> {
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
    for (let i = 0; i < line.length; i++) {
        if (line[i] !== '#') continue;
        const prev = i > 0 ? line[i - 1] : '';
        if (prev === '\\') continue;
        if (i > 0 && /\s/.test(prev)) {
            return line.slice(0, i).trimEnd();
        }
    }
    return line;
}

export function parseMyCalKeyValueText(text: string): IcsEvent[] {
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
            try {
                const obj = JSON.parse(v);
                if (obj && typeof obj === 'object' && typeof (obj as any).trigger === 'string') {
                    (cur.valarms ??= []).push(obj as IcsValarm);
                }
            } catch {
                // ignore
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

export function parseIcs(ics: string): IcsEvent[] {
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
            curAlarm = null;
            if (cur && hasMeaningfulEvent(cur)) events.push(cur);
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
                cur.recurrence_id = `DATE:${ridVal}`;
            } else if (tzid) {
                cur.recurrence_id = `${tzid}:${ridVal}`;
                if (!cur.tz) cur.tz = tzid;
            } else {
                cur.recurrence_id = ridVal;
            }
        }
    }

    return events;
}

export function parseImportText(text: string): IcsEvent[] {
    const t = text.trim();
    if (/BEGIN:VCALENDAR/i.test(t) || /BEGIN:VEVENT/i.test(t)) return parseIcs(text);
    return parseMyCalKeyValueText(text);
}
