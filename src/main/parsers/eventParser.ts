// src/main/parsers/eventParser.ts

// NOTE:
// Hand-written calendar notes are treated as untrusted input.
// Any invalid syntax, date, or timezone MUST NOT break calendar rendering.
// Invalid events are silently skipped.

type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

type EventInput = {
    id: string;
    title: string;
    description?: string;
    location?: string;
    color?: string;
    exdates?: string[];

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
};

const EVENT_BLOCK_RE =
    /(?:^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;

const DAY_MS = 24 * 60 * 60 * 1000;

// Map: MO..SU -> 0..6 (Mon..Sun)
const WD_MAP: Record<string, number> = {MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6};

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
    valarm?: string;
    exdate?: string[];
};

type ParsedBlockScalarKey = Exclude<keyof ParsedBlockFields, 'exdate'>;

function parseKeyVal(line: string): [string, string] | null {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+)\s*$/);
    if (!m) return null;
    if (!m[2] || !m[2].trim()) return null;
    return [m[1].toLowerCase(), m[2]];
}

function parseByWeekdays(v: string): number[] | undefined {
    const arr = v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const out = new Set<number>();
    for (const t of arr) {
        if (t in WD_MAP) out.add(WD_MAP[t]);
    }
    return out.size ? Array.from(out).sort((a, b) => a - b) : undefined;
}

function parseIntSafe(v?: string): number | undefined {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : undefined;
}

function parseByMonthDay(v: string): number | undefined {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : undefined;
}

function parseAllDayBool(v: string): boolean | undefined {
    const vv = v.trim().toLowerCase();
    if (vv === 'true' || vv === '1' || vv === 'yes') return true;
    if (vv === 'false' || vv === '0' || vv === 'no') return false;
    return undefined;
}

export function normalizeTz(z?: string): string | undefined {
    if (!z) return undefined;
    const tz = z.trim();
    if (!tz) return undefined;

    try {
        // If the timezone is not IANA, Intl will throw RangeError
        new Intl.DateTimeFormat('en-US', {timeZone: tz}).format(new Date());
        return tz;
    } catch {
        return undefined;
    }
}

// "2025-08-12 10:00:00-04:00" | "2025-08-12T10:00:00-04:00" | Without offset (з tz)
export function parseDateTimeToUTC(text: string, tz?: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // Explicit offset or Z -> trust Date parsing (absolute moment)
    if (/[+-]\d{2}:?\d{2}$/.test(trimmed) || /Z$/i.test(trimmed)) {
        const canon = trimmed
            .replace(' ', 'T')
            .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'); // +0300 -> +03:00
        const d = new Date(canon);
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    // No offset: parse wall-clock components
    const m = trimmed.match(
        /^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/
    );
    if (!m) {
        const d = new Date(trimmed.replace(' ', 'T'));
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const da = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6] ?? '0');

    // If tz is given but is invalid - DO NOT try to convert, return null (and the event will be skipped)
    const safeTz = normalizeTz(tz);

    // If tz is not provided -> interpret as device-local time (no conversion)
    if (!safeTz) {
        if (tz && tz.trim()) return null;
        const d = new Date(
            `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(ss).padStart(2, '0')}`
        );
        return isNaN(d.getTime()) ? null : d.getTime();
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
    const vv = v.trim().toLowerCase();
    if (vv === 'daily' || vv === 'weekly' || vv === 'monthly' || vv === 'yearly' || vv === 'none') return vv;
    return undefined;
}

function assignParsedField(fields: ParsedBlockFields, key: ParsedBlockScalarKey, value: string): void {
    fields[key] = value;
}

function appendParsedExdate(fields: ParsedBlockFields, value: string): void {
    (fields.exdate ??= []).push(value);
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
        const color = fields.color;
        const startText = fields.start;
        const endText = fields.end;
        const tz = fields.tz?.trim();

        const repeat = parseRepeatFreq(fields.repeat ?? '') ?? 'none';
        const repeatInterval = parseIntSafe(fields.repeat_interval) ?? 1;
        const byWeekdays = fields.byweekday ? parseByWeekdays(fields.byweekday) : undefined;
        const byMonthDay = fields.bymonthday ? parseByMonthDay(fields.bymonthday) : undefined;
        const allDay = fields.all_day ? parseAllDayBool(fields.all_day) : undefined;
        const exdates = Array.isArray(fields.exdate) ? fields.exdate.filter(Boolean) : undefined;

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
            if (endUtc != null) {
                // ICS all-day uses exclusive end -> make it inclusive for UI
                if (endUtc > startUtc) endUtc = endUtc - 1;
                else endUtc = startUtc + DAY_MS - 1; // insurance
            } else {
                // if end not provided, treat as one-day all-day
                endUtc = startUtc + DAY_MS - 1;
            }
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

            allDay,
            hasAlarms: !!fields.valarm,
        });
    }

    return out;
}

export type {EventInput, RepeatFreq};
