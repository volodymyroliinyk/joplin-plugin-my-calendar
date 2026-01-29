// src/main/utils/dateTimeUtils.ts

export function parseIsoDurationToMs(s: string): number | null {
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

export function parseMyCalDateToDate(s?: string): Date | null {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    const iso = t.replace(' ', 'T');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

export function formatAlarmTitleTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(d: Date, days: number): Date {
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + days);
    return out;
}

export function addMonths(d: Date, months: number): Date {
    const out = new Date(d.getTime());
    out.setMonth(out.getMonth() + months);
    return out;
}

export function addYears(d: Date, years: number): Date {
    const out = new Date(d.getTime());
    out.setFullYear(out.getFullYear() + years);
    return out;
}

export function weekdayToJs(day: string): number | null {
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

export function formatDateForAlarm(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

export function icsDateToMyCalText(icsValue: string): string | undefined {
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

export function computeAlarmWhen(alarm: { trigger: string; related?: 'START' | 'END' }, occ: {
    start: Date;
    end: Date
}): Date | null {
    const trig = alarm.trigger.trim();
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

        const mins = Math.floor(absMs / 60000);
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

        return isBefore ? `${timeStr} before` : (ms === 0 ? 'at time of event' : `${timeStr} after`);
    }
    return 'at specific time';
}
