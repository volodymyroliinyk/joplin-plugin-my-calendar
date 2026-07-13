import {IcsEvent} from '../types/icsTypes';

export const REPEAT_FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type RepeatFrequency = typeof REPEAT_FREQUENCIES[number];

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTimeZone(value?: string): string | undefined {
    const timeZone = String(value || '').trim();
    if (!timeZone) return undefined;
    try {
        new Intl.DateTimeFormat('en-US', {timeZone}).format(new Date());
        return timeZone;
    } catch {
        return undefined;
    }
}

export function normalizeRepeatFrequency(value: unknown): RepeatFrequency {
    const normalized = String(value || '').trim().toLowerCase();
    return (REPEAT_FREQUENCIES as readonly string[]).includes(normalized)
        ? normalized as RepeatFrequency
        : 'none';
}

export function normalizeRepeatInterval(value: unknown, max: number = Number.MAX_SAFE_INTEGER): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export function normalizeMonthDay(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(String(value || '').trim());
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : undefined;
}

export function normalizeWeekdayIndices(value: unknown): number[] | undefined {
    const tokens = Array.isArray(value) ? value : String(value || '').split(',');
    const indices = new Set<number>();
    for (const token of tokens) {
        const index = WEEKDAYS.indexOf(String(token || '').trim().toUpperCase() as typeof WEEKDAYS[number]);
        if (index >= 0) indices.add(index);
    }
    return indices.size ? [...indices].sort((a, b) => a - b) : undefined;
}

export function canonicalWeekdays(value: unknown, rejectInvalid: boolean = false): string | undefined {
    if (rejectInvalid) {
        for (const token of String(value || '').split(',').map((part) => part.trim().toUpperCase()).filter(Boolean)) {
            if (!(WEEKDAYS as readonly string[]).includes(token)) throw new Error(`Invalid weekday: ${token}`);
        }
    }
    const indices = normalizeWeekdayIndices(value);
    return indices?.map((index) => WEEKDAYS[index]).join(',');
}

export function parseCalendarBoolean(value: unknown): boolean | undefined {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return undefined;
}

export function toInclusiveAllDayEndUtc(startUtc: number, exclusiveEndUtc?: number): number {
    return exclusiveEndUtc != null && exclusiveEndUtc > startUtc
        ? exclusiveEndUtc - 1
        : startUtc + DAY_MS - 1;
}

function dateOnlyText(value: string): string {
    const raw = value.trim();
    return raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || raw;
}

function addDaysToDateOnly(value: string, days: number): string {
    const match = dateOnlyText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * DAY_MS;
    const date = new Date(timestamp);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function normalizeAllDayDateRange(start: string, end?: string): { start: string; end: string } {
    const startDate = dateOnlyText(start);
    const endDate = dateOnlyText(end || '') || startDate;
    return {
        start: startDate,
        end: endDate <= startDate ? addDaysToDateOnly(startDate, 1) : addDaysToDateOnly(endDate, 1),
    };
}

export function normalizeRecurrenceExceptionDate(value: string): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    const dateOnly = raw.match(/^DATE:(\d{8})$/i);
    if (dateOnly) return `${dateOnly[1].slice(0, 4)}-${dateOnly[1].slice(4, 6)}-${dateOnly[1].slice(6, 8)} 00:00:00`;

    const compact = raw.match(/^(?:[^:]+:)?(\d{8})T(\d{6})(Z?)$/);
    if (!compact) return raw;
    const date = compact[1];
    const time = compact[2];
    const suffix = compact[3] ? '+00:00' : '';
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}${suffix}`;
}

export function normalizeIcsEvent(input: IcsEvent): IcsEvent {
    const repeat = normalizeRepeatFrequency(input.repeat);
    const timezone = normalizeTimeZone(input.tz);
    const monthDay = normalizeMonthDay(input.bymonthday);
    const exdates = Array.isArray(input.exdates)
        ? [...new Set(input.exdates.map((value) => String(value || '').trim()).filter(Boolean))]
        : undefined;
    return {
        ...input,
        uid: String(input.uid || '').trim() || undefined,
        recurrence_id: String(input.recurrence_id || '').trim() || undefined,
        tz: timezone,
        repeat,
        repeat_interval: normalizeRepeatInterval(input.repeat_interval),
        byweekday: canonicalWeekdays(input.byweekday),
        bymonthday: monthDay != null ? String(monthDay) : undefined,
        exdates: exdates?.length ? exdates : undefined,
        all_day: input.all_day === true,
        valarms: Array.isArray(input.valarms) ? input.valarms.map((alarm) => ({...alarm})) : undefined,
    };
}
