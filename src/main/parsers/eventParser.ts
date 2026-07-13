// src/main/parsers/eventParser.ts

// NOTE:
// Hand-written calendar notes are treated as untrusted input.
// Any invalid syntax, date, or timezone MUST NOT break calendar rendering.
// Invalid events are silently skipped.
import {normalizeColorIfHex} from '../utils/colorUtils';
import {IcsValarm} from '../types/icsTypes';
import {
    normalizeMonthDay,
    normalizeRepeatFrequency,
    normalizeRepeatInterval,
    normalizeTimeZone,
    normalizeWeekdayIndices,
    parseCalendarBoolean,
    RepeatFrequency,
    toInclusiveAllDayEndUtc,
} from '../services/calendarEventNormalizer';

type RepeatFreq = RepeatFrequency;

type EventInput = {
    id: string;
    title: string;
    description?: string;
    location?: string;
    color?: string;
    exdates?: string[];
    uid?: string;
    recurrenceId?: string;
    valarms?: IcsValarm[];

    startUtc: number;
    endUtc?: number;
    tz?: string;

    startText: string;
    endText?: string;

    repeat: RepeatFreq;
    repeatInterval: number;
    repeatUntilUtc?: number;
    byWeekdays?: number[];
    byMonthDay?: number;

    allDay?: boolean;
    hasAlarms?: boolean;
    is_todo?: number;
    todo_completed?: number;
    is_completed?: number;
};

const EVENT_BLOCK_RE =
    /(?:^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;

type ParsedBlockFields = {
    title?: string;
    description?: string;
    location?: string;
    color?: string;
    start?: string;
    end?: string;
    tz?: string;
    repeat?: string;
    repeat_interval?: string;
    repeat_until?: string;
    byweekday?: string;
    bymonthday?: string;
    all_day?: string;
    valarm?: string[];
    exdate?: string[];
    uid?: string;
    recurrence_id?: string;
};

type ParsedBlockScalarKey = Exclude<keyof ParsedBlockFields, 'exdate' | 'valarm'>;

function parseKeyVal(line: string): [string, string] | null {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+)\s*$/);
    if (!m) return null;
    if (!m[2] || !m[2].trim()) return null;
    return [m[1].toLowerCase(), m[2]];
}

function parseByWeekdays(v: string): number[] | undefined {
    return normalizeWeekdayIndices(v);
}

function parseIntSafe(v?: string): number | undefined {
    if (!v || !Number.isFinite(Number(v))) return undefined;
    return normalizeRepeatInterval(v);
}

function parseByMonthDay(v: string): number | undefined {
    return normalizeMonthDay(v);
}

function parseAllDayBool(v: string): boolean | undefined {
    return parseCalendarBoolean(v);
}

export function normalizeTz(z?: string): string | undefined {
    return normalizeTimeZone(z);
}

// "2025-08-12 10:00:00-04:00" | "2025-08-12T10:00:00-04:00" | Without offset (з tz)
function hasValidDateTimeComponents(y: number, mo: number, da: number, hh: number, mi: number, ss: number): boolean {
    if (!Number.isInteger(y) || y < 1 || y > 9999) return false;
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) return false;
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) return false;
    if (!Number.isInteger(mi) || mi < 0 || mi > 59) return false;
    if (!Number.isInteger(ss) || ss < 0 || ss > 59) return false;

    const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return Number.isInteger(da) && da >= 1 && da <= daysInMonth[mo - 1];
}

export function parseDateTimeToUTC(text: string, tz?: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (isDateOnlyText(trimmed)) {
        return parseDateTimeToUTC(`${trimmed} 00:00:00`, tz);
    }

    const dateTimeMatch = trimmed.match(
        /^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(Z|[+-][0-9]{2}:?[0-9]{2})?$/i
    );
    if (!dateTimeMatch) return null;

    const y = Number(dateTimeMatch[1]);
    const mo = Number(dateTimeMatch[2]);
    const da = Number(dateTimeMatch[3]);
    const hh = Number(dateTimeMatch[4]);
    const mi = Number(dateTimeMatch[5]);
    const ss = Number(dateTimeMatch[6] ?? '0');
    const offset = dateTimeMatch[7];

    if (!hasValidDateTimeComponents(y, mo, da, hh, mi, ss)) return null;

    // Explicit offset or Z represents an absolute moment.
    if (offset) {
        const offsetMatch = offset.match(/^([+-])([0-9]{2}):?([0-9]{2})$/);
        if (offsetMatch && (Number(offsetMatch[2]) > 23 || Number(offsetMatch[3]) > 59)) return null;
        const canon = trimmed
            .replace(' ', 'T')
            .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'); // +0300 -> +03:00
        const d = new Date(canon);
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    // If tz is given but is invalid - DO NOT try to convert, return null (and the event will be skipped)
    const safeTz = normalizeTz(tz);

    // If tz is not provided -> interpret as device-local time (no conversion)
    if (!safeTz) {
        if (tz && tz.trim()) return null;
        const d = new Date(
            `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}T${dateTimeMatch[4]}:${dateTimeMatch[5]}:${String(ss).padStart(2, '0')}`
        );
        if (isNaN(d.getTime())) return null;
        if (
            d.getFullYear() !== y || d.getMonth() + 1 !== mo || d.getDate() !== da ||
            d.getHours() !== hh || d.getMinutes() !== mi || d.getSeconds() !== ss
        ) return null;
        return d.getTime();
    }

    // tz provided without offset: interpret components as wall-clock time in that tz, then convert to UTC
    const wallUtc = Date.UTC(y, mo - 1, da, hh, mi, ss);

    const tzOffsetMs = (utcTs: number, zone: string): number | null => {
        try {
            const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: zone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });

            const parts = fmt.formatToParts(new Date(utcTs)).reduce<Record<string, string>>(
                (a, p) => {
                    if (p.type !== 'literal') a[p.type] = p.value;
                    return a;
                },
                {}
            );

            const yy = Number(parts.year);
            const mm = Number(parts.month) - 1;
            const dd = Number(parts.day);
            const h2 = Number(parts.hour);
            const m2 = Number(parts.minute);
            const s2 = Number(parts.second);

            const asUtc = Date.UTC(yy, mm, dd, h2, m2, s2);
            return asUtc - utcTs;
        } catch {
            return null;
        }
    };

    const off1 = tzOffsetMs(wallUtc, safeTz);
    if (off1 == null) return null;

    let utc = wallUtc - off1;

    const off2 = tzOffsetMs(utc, safeTz);
    if (off2 == null) return null;

    // second-pass for DST boundary correctness
    if (off2 !== off1) utc = wallUtc - off2;

    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: safeTz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date(utc)).reduce<Record<string, number>>((acc, part) => {
            if (part.type !== 'literal') acc[part.type] = Number(part.value);
            return acc;
        }, {});
        if (
            parts.year !== y || parts.month !== mo || parts.day !== da ||
            parts.hour !== hh || parts.minute !== mi || parts.second !== ss
        ) return null;
    } catch {
        return null;
    }

    return utc;
}

function isDateOnlyText(text: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(text.trim());
}

export function parseRepeatUntilToUTC(text: string, tz?: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (isDateOnlyText(trimmed)) {
        return parseDateTimeToUTC(`${trimmed} 23:59:59`, tz);
    }

    return parseDateTimeToUTC(trimmed, tz);
}

function parseRepeatFreq(v: string): RepeatFreq | undefined {
    const normalized = normalizeRepeatFrequency(v);
    return normalized === 'none' && v.trim().toLowerCase() !== 'none' ? undefined : normalized;
}

function assignParsedField(fields: ParsedBlockFields, key: ParsedBlockScalarKey, value: string): void {
    fields[key] = value;
}

function appendParsedExdate(fields: ParsedBlockFields, value: string): void {
    (fields.exdate ??= []).push(value);
}

function appendParsedValarm(fields: ParsedBlockFields, value: string): void {
    (fields.valarm ??= []).push(value);
}

function parseValarms(values: string[] | undefined): IcsValarm[] | undefined {
    const alarms: IcsValarm[] = [];
    for (const value of values ?? []) {
        try {
            const alarm = JSON.parse(value) as Partial<IcsValarm>;
            if (alarm && typeof alarm === 'object' && typeof alarm.trigger === 'string' && alarm.trigger.trim()) {
                alarms.push({...alarm, trigger: alarm.trigger.trim()} as IcsValarm);
            }
        } catch {
            // Invalid alarm metadata must not make the event unavailable.
        }
    }
    return alarms.length ? alarms : undefined;
}

export function parseEventsFromBody(noteId: string, titleFallback: string, body: string): EventInput[] {
    const out: EventInput[] = [];
    let m: RegExpExecArray | null;

    // Defensive: avoid leaking RegExp.lastIndex across calls (EVENT_BLOCK_RE is /g)
    EVENT_BLOCK_RE.lastIndex = 0;

    while ((m = EVENT_BLOCK_RE.exec(body)) !== null) {
        // IMPORTANT: reset per block (do not leak across blocks)

        const block = m[1];
        const lines = block.split('\n').map(l => l.replace(/\r$/, ''));

        const fields: ParsedBlockFields = {};
        let currentKey: ParsedBlockScalarKey | null = null;
        const multilineKeys = new Set<ParsedBlockScalarKey>(['description']);

        for (const rawLine of lines) {
            const kv = parseKeyVal(rawLine);
            if (kv) {
                const [k, v] = kv;
                if (k === 'exdate') {
                    appendParsedExdate(fields, v);
                } else if (k === 'valarm') {
                    appendParsedValarm(fields, v);
                } else {
                    assignParsedField(fields, k as ParsedBlockScalarKey, v);
                }
                currentKey = multilineKeys.has(k as ParsedBlockScalarKey) ? (k as ParsedBlockScalarKey) : null;
                continue;
            }
            if (currentKey && multilineKeys.has(currentKey)) {
                const existing = fields[currentKey] ?? '';
                fields[currentKey] = existing ? `${existing}\n${rawLine}` : rawLine;
            }
        }

        const title = (fields.title?.trim() ? fields.title.trim() : titleFallback);
        const description = fields.description;
        const location = fields.location;
        const color = normalizeColorIfHex(fields.color, {allowShort: true}) || undefined;
        const startText = fields.start;
        const endText = fields.end;
        const tz = fields.tz?.trim();

        const repeat = parseRepeatFreq(fields.repeat ?? '') ?? 'none';
        const repeatInterval = parseIntSafe(fields.repeat_interval) ?? 1;
        const byWeekdays = fields.byweekday ? parseByWeekdays(fields.byweekday) : undefined;
        const byMonthDay = fields.bymonthday ? parseByMonthDay(fields.bymonthday) : undefined;
        const allDay = fields.all_day ? parseAllDayBool(fields.all_day) : undefined;
        const exdates = Array.isArray(fields.exdate) ? fields.exdate.filter(Boolean) : undefined;
        const valarms = parseValarms(fields.valarm);

        if (!startText) continue;

        const startUtc = parseDateTimeToUTC(startText, tz);
        if (startUtc == null) continue;

        let endUtc: number | undefined;
        if (endText) {
            const e = parseDateTimeToUTC(endText, tz);
            if (e != null) endUtc = e;
        }

        // repeat_until parsed AFTER tz is known (order-independent)
        let repeatUntilUtc: number | undefined;
        if (fields.repeat_until) {
            const u = parseRepeatUntilToUTC(fields.repeat_until, tz);
            if (u != null) repeatUntilUtc = u;
        }

        if (allDay) {
            endUtc = toInclusiveAllDayEndUtc(startUtc, endUtc);
        }

        out.push({
            id: noteId,
            title,
            description,
            location,
            color,

            startUtc,
            endUtc,
            tz,

            startText,
            endText,

            repeat,
            repeatInterval,
            repeatUntilUtc,
            byWeekdays,
            byMonthDay,
            exdates,
            uid: fields.uid?.trim() || undefined,
            recurrenceId: fields.recurrence_id?.trim() || undefined,
            valarms,

            allDay,
            hasAlarms: !!valarms?.length,
        });
    }

    return out;
}

export type {EventInput, RepeatFreq};
