// Події парсимо тільки якщо в блоці є рядок: calendar: my-calendar-plugin
export const REQUIRED_CALENDAR_TOKEN = 'my-calendar-plugin';

type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

type EventInput = {
    id: string;
    title: string;
    desc?: string;
    color?: string;

    startUtc: number;
    endUtc?: number;

    startText: string;
    endText?: string;

    repeat: RepeatFreq;
    repeatInterval: number;
    repeatUntilUtc?: number;
    byWeekdays?: number[];
    byMonthDay?: number;
};

const EVENT_BLOCK_RE = /(?:^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;

// Map: MO..SU -> 0..6 (Mon..Sun)
const WD_MAP: Record<string, number> = { MO:0, TU:1, WE:2, TH:3, FR:4, SA:5, SU:6 };

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

// "2025-08-12 10:00:00-04:00" | "2025-08-12T10:00:00-04:00" | без офсета (з tz)
function parseDateTimeToUTC(text: string, tz?: string): number | null {
    const trimmed = text.trim();
    // є явний офсет -> довіряємо Date
    if (/[+-]\d{2}:?\d{2}$/.test(trimmed)) {
        const canon = trimmed.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        const d = new Date(canon);
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    // без офсета, але з tz -> розрахунок UTC через Intl
    try {
        const local = new Date(trimmed.replace(' ', 'T'));
        if (isNaN(local.getTime())) return null;
        if (!tz) return local.getTime();

        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const parts = fmt.formatToParts(local).reduce<Record<string,string>>((a, p) => {
            if (p.type !== 'literal') a[p.type] = p.value;
            return a;
        }, {});
        const y = Number(parts.year), m = Number(parts.month)-1, d = Number(parts.day);
        const hh = Number(parts.hour), mm = Number(parts.minute), ss = Number(parts.second);
        return Date.UTC(y, m, d, hh, mm, ss);
    } catch {
        return null;
    }
}

export function parseEventsFromBody(noteId: string, titleFallback: string, body: string): EventInput[] {
    const out: EventInput[] = [];
    let m: RegExpExecArray | null;

    while ((m = EVENT_BLOCK_RE.exec(body)) !== null) {
        const block = m[1];
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

        // 2) Звичайний парсинг
        let title = titleFallback;
        let desc: string | undefined;
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
            else if (k === 'desc' || k === 'description') desc = v;
            else if (k === 'color') color = v;
            else if (k === 'start') startText = v;
            else if (k === 'end') endText = v;
            else if (k === 'tz' || k === 'timezone') tz = v;

            else if (k === 'repeat') {
                const val = v.toLowerCase();
                repeat = (['daily','weekly','monthly','yearly'].includes(val) ? val : 'none') as RepeatFreq;
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

        out.push({
            id: noteId,
            title,
            desc,
            color,
            startUtc,
            endUtc,
            startText,
            endText,
            repeat,
            repeatInterval,
            repeatUntilUtc,
            byWeekdays,
            byMonthDay,
        });
    }

    return out;
}

export type { EventInput, RepeatFreq };