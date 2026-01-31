// src/main/utils/dateTimeUtils.ts

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const WEEKDAY_TO_JS: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function parseIsoDurationToMs(s: string): number | null {
    const t = s.trim().toUpperCase();
    if (!t) return null;

    const sign = t.startsWith('-') ? -1 : 1;
    const core = t.startsWith('-') || t.startsWith('+') ? t.slice(1) : t;
    // Supported subset: PnWnDTnHnMnS (no months/years)
    const m = core.match(
        /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
    );
    if (!m) return null;
    const parts = m.slice(1);
    // Reject bare "P" / "PT" (no components)
    if (parts.every(v => v == null)) return null;

    const w = m[1] ? Number(m[1]) : 0;
    const d = m[2] ? Number(m[2]) : 0;
    const h = m[3] ? Number(m[3]) : 0;
    const mi = m[4] ? Number(m[4]) : 0;
    const se = m[5] ? Number(m[5]) : 0;

    if (![w, d, h, mi, se].every(n => Number.isFinite(n))) return null;
    const ms =
        (w * 7 + d) * MS_PER_DAY +
        h * MS_PER_HOUR +
        mi * MS_PER_MINUTE +
        se * MS_PER_SECOND;

    return sign * ms;
}

export function parseMyCalDateToDate(s?: string): Date | null {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;

    // Accept either "YYYY-MM-DD HH:mm:ss(+00:00)" or ISO-like forms.
    const iso = t.replace(' ', 'T');
    const d = new Date(iso);

    return Number.isNaN(d.getTime()) ? null : d;
}

export function formatAlarmTitleTime(d: Date): string {
    // Intentionally local time (UI/notification title)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function addDays(d: Date, days: number): Date {
    const out = new Date(d.getTime());
    // Use UTC variants to avoid DST/timezone shifts when input is a UTC instant.
    out.setUTCDate(out.getUTCDate() + days);
    return out;
}

export function addMonths(d: Date, months: number): Date {
    const out = new Date(d.getTime());
    out.setUTCMonth(out.getUTCMonth() + months);
    return out;
}

export function addYears(d: Date, years: number): Date {
    const out = new Date(d.getTime());
    out.setUTCFullYear(out.getUTCFullYear() + years);
    return out;
}

export function weekdayToJs(day: string): number | null {
    const d = day.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(WEEKDAY_TO_JS, d) ? WEEKDAY_TO_JS[d] : null;
}

export function formatDateForAlarm(d: Date): string {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+00:00`;
}

export function icsDateToMyCalText(icsValue: string): string | undefined {
    if (!icsValue) return undefined;
    const raw = icsValue.trim();
    if (!raw) return undefined;
    // normalize trailing "z" -> "Z"
    const v = raw.endsWith('z') ? `${raw.slice(0, -1)}Z` : raw;

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

export function computeAlarmWhen(alarm: { trigger: string; related?: 'START' | 'END' }, occ: {
    start: Date;
    end: Date
}): Date | null {
    const trig = alarm.trigger.trim();
    if (!trig) return null;
    const abs = icsDateToMyCalText(trig);
    if (abs) return parseMyCalDateToDate(abs);
    const delta = parseIsoDurationToMs(trig);
    if (delta === null) return null;
    const base = alarm.related === 'END' ? occ.end : occ.start;
    return new Date(base.getTime() + delta);
}

export function formatTriggerDescription(trigger: string): string {
    const t = trigger.trim().toUpperCase();
    if (t.startsWith('P') || t.startsWith('-P') || t.startsWith('+P')) {
        const ms = parseIsoDurationToMs(t);
        if (ms === null) return t;

        const isBefore = ms < 0;
        const absMs = Math.abs(ms);

        if (ms === 0) return 'at time of event';
        const mins = Math.floor(absMs / MS_PER_MINUTE);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);

        let timeStr = '';
        if (days > 0) {
            timeStr = `${days} day${days > 1 ? 's' : ''}`;
        } else if (hours > 0) {
            timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
        } else {
            timeStr = `${mins} minute${mins !== 1 ? 's' : ''}`;
        }

        return isBefore ? `${timeStr} before` : `${timeStr} after`;
    }
    return 'at specific time';
}


