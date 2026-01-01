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
};

const EVENT_BLOCK_RE = /(?:^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;

// Map: MO..SU -> 0..6 (Mon..Sun)
const WD_MAP: Record<string, number> = {MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6};

function parseKeyVal(line: string): [string, string] | null {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+)\s*$/);
    return m ? [m[1].toLowerCase(), m[2]] : null;
}

function parseByWeekdays(v: string): number[] | undefined {
    const arr = v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const out: number[] = [];
    for (const t of arr) if (t in WD_MAP) out.push(WD_MAP[t]);
    return out.length ? out : undefined;
}

function parseIntSafe(v?: string): number | undefined {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : undefined;
}

// "2025-08-12 10:00:00-04:00" | "2025-08-12T10:00:00-04:00" | Without offset (з tz)
function parseDateTimeToUTC(text: string, tz?: string): number | null {
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
    const m = trimmed.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/);
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

        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${String(ss).padStart(2, '0')}`);
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    // tz provided without offset: interpret components as wall-clock time in that tz, then convert to UTC
    const wallUtc = Date.UTC(y, mo - 1, da, hh, mi, ss);

    const tzOffsetMs = (utcTs: number, zone: string): number => {
        try {
            const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: zone,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            });
            const parts = fmt.formatToParts(new Date(utcTs)).reduce<Record<string, string>>((a, p) => {
                if (p.type !== 'literal') a[p.type] = p.value;
                return a;
            }, {});
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

    try {
        const off1 = tzOffsetMs(wallUtc, safeTz);
        let utc = wallUtc - off1;
        const off2 = tzOffsetMs(utc, safeTz);
        if (off2 !== off1) utc = wallUtc - off2;
        return utc;
    } catch {
        return null;
    }
}

function normalizeTz(tz?: string): string | undefined {
    const z = (tz || '').trim();
    if (!z) return undefined;

    try {
        // If the timezone is not IANA, there will be a RangeError here
        new Intl.DateTimeFormat('en-US', {timeZone: z}).format(new Date());
        return z;
    } catch {
        return undefined;
    }
}

export function parseEventsFromBody(noteId: string, titleFallback: string, body: string): EventInput[] {
    let allDay: boolean | undefined;

    const out: EventInput[] = [];
    let m: RegExpExecArray | null;

    while ((m = EVENT_BLOCK_RE.exec(body)) !== null) {
        const block = m[1];
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

        // 2) Ordinary Parsing
        let title = titleFallback;
        let description: string | undefined;
        let location: string | undefined;
        let color: string | undefined;
        let startText: string | undefined;
        let endText: string | undefined;
        let tz: string | undefined;

        let repeat: RepeatFreq = 'none';
        let repeatInterval = 1;
        let repeatUntilUtc: number | undefined;
        let byWeekdays: number[] | undefined;
        let byMonthDay: number | undefined;

        for (const line of lines) {
            const kv = parseKeyVal(line);
            if (!kv) continue;
            const [k, v] = kv;

            if (k === 'title') title = v;
            else if (k === 'description') description = v;
            else if (k === 'location') location = v;
            else if (k === 'color') color = v;
            else if (k === 'start') startText = v;
            else if (k === 'end') endText = v;
            else if (k === 'tz' || k === 'timezone') tz = v;

            else if (k === 'repeat') {
                const val = v.toLowerCase();
                repeat = (['daily', 'weekly', 'monthly', 'yearly'].includes(val) ? val : 'none') as RepeatFreq;
            } else if (k === 'repeat_interval') {
                const n = parseIntSafe(v);
                if (n) repeatInterval = n;
            } else if (k === 'repeat_until') {
                const u = parseDateTimeToUTC(v, tz);
                if (u != null) repeatUntilUtc = u;
            } else if (k === 'byweekday') {
                byWeekdays = parseByWeekdays(v);
            } else if (k === 'bymonthday') {
                const n = parseInt(v, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 31) byMonthDay = n;
            } else if (k === 'all_day') {
                const vv = v.trim().toLowerCase();
                if (vv === 'true' || vv === '1' || vv === 'yes') allDay = true;
                else if (vv === 'false' || vv === '0' || vv === 'no') allDay = false;
            }
        }

        if (!startText) continue;
        const startUtc = parseDateTimeToUTC(startText, tz);
        if (startUtc == null) continue;

        let endUtc: number | undefined;
        if (endText) {
            const e = parseDateTimeToUTC(endText, tz);
            if (e != null) endUtc = e;
        }

        const DAY_MS = 24 * 60 * 60 * 1000;

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

            allDay,
        });
    }

    return out;
}

export type {EventInput, RepeatFreq};