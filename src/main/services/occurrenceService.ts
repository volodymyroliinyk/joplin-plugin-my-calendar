import {IcsEvent} from '../types/icsTypes';
import {EventInput, parseDateTimeToUTC, parseRepeatUntilToUTC} from '../parsers/eventParser';
import {
    parseYmdHmsLocal,
    zonedTimeToUtcMs,
    addDaysYMD,
    getPartsInTz,
    getPartsInTzHms,
    weekdayMon0,
    DAY_MS,
    Occurrence as UiOccurrence
} from '../utils/dateUtils';
import {dbg, warn} from '../utils/logger';
import {
    normalizeIcsEvent,
    normalizeMonthDay,
    normalizeTimeZone,
    normalizeWeekdayIndices,
    toInclusiveAllDayEndUtc,
} from './calendarEventNormalizer';

export type Occurrence = { start: Date; end: Date; recurrence_id?: string };

export const MAX_OCCURRENCES_PER_EVENT = 2_000;
export const MAX_OCCURRENCES_PER_REQUEST = 10_000;
const MAX_RECURRENCE_ITERATIONS_PER_EVENT = 10_000;

/** Tests whether an event overlaps a half-open [fromUtc, toUtc) range. */
export function eventOverlapsRange(startUtc: number, endUtc: number | undefined, fromUtc: number, toUtc: number): boolean {
    const effectiveEnd = endUtc ?? startUtc;
    if (effectiveEnd <= startUtc) {
        return startUtc >= fromUtc && startUtc < toUtc;
    }
    return startUtc < toUtc && effectiveEnd > fromUtc;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function formatLocalYmdHms(msUtc: number, tz: string): string {
    const p = getPartsInTzHms(msUtc, tz);
    return `${p.Y}-${pad2(p.M)}-${pad2(p.D)} ${pad2(p.h)}:${pad2(p.m)}:${pad2(p.sec)}`;
}

function parseByWeekdaysStrToMon0(v?: string): number[] | undefined {
    return normalizeWeekdayIndices(v);
}

function parseByMonthDaySafe(v?: string): number | undefined {
    return normalizeMonthDay(v);
}

function parseTzSafe(tz?: string): string {
    return normalizeTimeZone(tz) || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function hasExplicitOffsetOrZulu(text?: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    return /(?:[+-]\d{2}:?\d{2}|Z)$/i.test(trimmed);
}

function resolveOccurrenceTimeZone(ev: IcsEvent): string {
    if (ev.tz) return parseTzSafe(ev.tz);
    if (
        hasExplicitOffsetOrZulu(ev.start) ||
        hasExplicitOffsetOrZulu(ev.end) ||
        hasExplicitOffsetOrZulu(ev.repeat_until)
    ) {
        return 'UTC';
    }
    return parseTzSafe();
}

function toUtcOrNull(text: string | undefined, tz: string): number | null {
    if (!text) return null;
    return parseDateTimeToUTC(text, tz);
}

function buildExcludedStartSet(exdates: string[] | undefined, tz: string): Set<number> {
    const out = new Set<number>();
    for (const exdate of exdates ?? []) {
        const utc = toUtcOrNull(exdate, tz);
        if (utc != null) out.add(utc);
    }
    return out;
}

function zonedTimeToUtcMsOrNull(
    localY: number,
    localM: number,
    localD: number,
    localH: number,
    localMin: number,
    localSec: number,
    tz: string,
    context: { id: string; title: string },
): number | null {
    try {
        return zonedTimeToUtcMs(localY, localM, localD, localH, localMin, localSec, tz);
    } catch (error) {
        dbg('occurrence', 'Skipping non-existent recurrence local time:', {
            id: context.id,
            title: context.title,
            tz,
            local: `${localY}-${pad2(localM)}-${pad2(localD)} ${pad2(localH)}:${pad2(localMin)}:${pad2(localSec)}`,
            error,
        });
        return null;
    }
}

export function expandOccurrences(input: IcsEvent, windowStart: Date, windowEnd: Date): Occurrence[] {
    const ev = normalizeIcsEvent(input);
    if (!ev.start) return [];
    if (String(ev.status || '').trim().toLowerCase() === 'cancelled') return [];

    const tz = resolveOccurrenceTimeZone(ev);
    const startUtc = toUtcOrNull(ev.start, tz);
    if (startUtc == null) return [];

    let endUtc = toUtcOrNull(ev.end, tz) ?? startUtc;
    if (ev.all_day) {
        endUtc = toInclusiveAllDayEndUtc(startUtc, endUtc);
    }

    const repeatUntilUtc = ev.repeat_until ? (parseRepeatUntilToUTC(ev.repeat_until, tz) ?? undefined) : undefined;

    const eventInput: EventInput = {
        id: ev.uid || 'ics',
        title: ev.title || 'Event',
        startUtc,
        endUtc,
        tz,
        startText: ev.start,
        endText: ev.end,
        repeat: ev.repeat || 'none',
        repeatInterval: ev.repeat_interval && ev.repeat_interval >= 1 ? ev.repeat_interval : 1,
        repeatUntilUtc,
        byWeekdays: parseByWeekdaysStrToMon0(ev.byweekday),
        byMonthDay: parseByMonthDaySafe(ev.bymonthday),
        exdates: ev.exdates,
        allDay: ev.all_day,
    };

    const occs = expandOccurrencesInRange(eventInput, windowStart.getTime(), windowEnd.getTime());
    return occs.map((o: UiOccurrence) => ({
        start: new Date(o.startUtc),
        end: new Date(o.endUtc ?? o.startUtc),
        recurrence_id: undefined,
    }));
}

function expandOccurrencesInRange(
    ev: EventInput,
    fromUtc: number,
    toUtc: number,
    occurrenceLimit: number = MAX_OCCURRENCES_PER_EVENT,
): UiOccurrence[] {
    // Invariant: recurring events must have timezone
    const tz = ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (ev.repeat !== 'none' && !ev.tz) {
        dbg('occurrence', 'Recurring event has no timezone; using device timezone:', {tz, title: ev.title, id: ev.id});
    }

    const dur = (ev.endUtc ?? ev.startUtc) - ev.startUtc;
    const excludedStarts = buildExcludedStartSet(ev.exdates, tz);
    const effectiveOccurrenceLimit = Math.max(0, Math.min(MAX_OCCURRENCES_PER_EVENT, Math.trunc(occurrenceLimit)));
    let iterations = 0;
    let limitWarningLogged = false;
    const warnLimit = (limit: string) => {
        if (limitWarningLogged) return;
        limitWarningLogged = true;
        warn('occurrence', `Recurrence expansion truncated by ${limit}`, {
            id: ev.id,
            title: ev.title,
            repeat: ev.repeat,
            fromUtc,
            toUtc,
        });
    };
    const beginIteration = (): boolean => {
        iterations++;
        if (iterations <= MAX_RECURRENCE_ITERATIONS_PER_EVENT) return true;
        warnLimit('iteration limit');
        return false;
    };
    const push = (start: number, out: UiOccurrence[]) => {
        if (start >= toUtc) return false;
        const end = dur ? start + dur : start;
        if (!eventOverlapsRange(start, end, fromUtc, toUtc)) return true;
        if (excludedStarts.has(start)) return true;
        if (out.length >= effectiveOccurrenceLimit) {
            warnLimit('per-event occurrence limit');
            return false;
        }
        out.push({...ev, occurrenceId: `${ev.id}#${start}`, startUtc: start, endUtc: dur ? end : undefined});
        return true;
    };

    if (ev.repeat === 'none') {
        if (!eventOverlapsRange(ev.startUtc, ev.endUtc, fromUtc, toUtc)) return [];
        if (effectiveOccurrenceLimit === 0) return [];
        return [{...ev, occurrenceId: `${ev.id}#${ev.startUtc}`}];
    }

    const out: UiOccurrence[] = [];
    const baseStartText = ev.startText || formatLocalYmdHms(ev.startUtc, tz);
    const baseLocal = parseYmdHmsLocal(baseStartText);
    const baseY = baseLocal.Y, baseM = baseLocal.M, baseD = baseLocal.D;
    const baseH = baseLocal.h, baseMin = baseLocal.m, baseS = baseLocal.sec;
    const until = ev.repeatUntilUtc ?? toUtc;
    const step = Math.max(1, ev.repeatInterval || 1);
    const eventContext = {id: ev.id, title: ev.title};

    if (ev.repeat === 'daily') {
        const from2 = fromUtc - Math.max(0, dur);
        const fromLocal = getPartsInTz(from2, tz);
        const baseDateUtc = Date.UTC(baseY, baseM - 1, baseD);
        const fromDateUtc = Date.UTC(fromLocal.Y, fromLocal.M - 1, fromLocal.D);

        let k = Math.floor((fromDateUtc - baseDateUtc) / (DAY_MS * step));
        if (k < 0) k = 0;

        for (; ; k++) {
            if (!beginIteration()) break;
            const occ = addDaysYMD(baseY, baseM, baseD, k * step);
            const start = zonedTimeToUtcMsOrNull(occ.Y, occ.M, occ.D, baseH, baseMin, baseS, tz, eventContext);
            if (start == null) continue;
            if (start < from2) continue;
            if (start > until) break;
            if (!push(start, out)) break;
        }
        return out;
    }

    if (ev.repeat === 'weekly') {
        const baseWd = weekdayMon0(baseLocal.Y, baseLocal.M, baseLocal.D);

        const list = ev.byWeekdays && ev.byWeekdays.length ? ev.byWeekdays : [baseWd];
        const step = Math.max(1, ev.repeatInterval || 1);
        const from2 = fromUtc - Math.max(0, dur);

        // Monday of base week (local date)
        const mondayBase = addDaysYMD(baseLocal.Y, baseLocal.M, baseLocal.D, -baseWd);

        // Start from the week containing "fromUtc" in local TZ
        const fromLocal = getPartsInTz(from2, tz);
        const fromWd = weekdayMon0(fromLocal.Y, fromLocal.M, fromLocal.D);
        const mondayFrom = addDaysYMD(fromLocal.Y, fromLocal.M, fromLocal.D, -fromWd);

        // Compute week index offset (in local calendar days)
        const mondayBaseMs = Date.UTC(mondayBase.Y, mondayBase.M - 1, mondayBase.D);
        const mondayFromMs = Date.UTC(mondayFrom.Y, mondayFrom.M - 1, mondayFrom.D);

        let weeksDiff = Math.floor((mondayFromMs - mondayBaseMs) / (7 * DAY_MS));
        if (weeksDiff < 0) weeksDiff = 0;

        let weekIndex = Math.floor(weeksDiff / step);

        const until = Math.min(toUtc, ev.repeatUntilUtc ?? Number.POSITIVE_INFINITY);

        for (; ;) {
            if (!beginIteration()) break;
            const weekStart = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, weekIndex * 7 * step);

            for (const wd of list) {
                const occ = addDaysYMD(weekStart.Y, weekStart.M, weekStart.D, wd);

                const start = zonedTimeToUtcMsOrNull(occ.Y, occ.M, occ.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz, eventContext);
                if (start == null) continue;
                if (start < from2 || start > until) continue;

                if (!push(start, out)) return out;
            }

            // stop condition: next week start beyond range
            const nextWeek = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, (weekIndex + 1) * 7 * step);
            const nextWeekStartUtc = zonedTimeToUtcMsOrNull(nextWeek.Y, nextWeek.M, nextWeek.D, 0, 0, 0, tz, eventContext);
            if (nextWeekStartUtc != null && nextWeekStartUtc > toUtc) break;

            weekIndex++;
        }
        return out;
    }

    if (ev.repeat === 'monthly') {
        const dom = ev.byMonthDay ?? baseD;
        let monthIndex = (baseY * 12) + (baseM - 1);
        const fromLocal = getPartsInTz(fromUtc - Math.max(0, dur), tz);
        const fromMonthIndex = (fromLocal.Y * 12) + (fromLocal.M - 1);
        if (fromMonthIndex > monthIndex) {
            const monthDiff = fromMonthIndex - monthIndex;
            monthIndex += Math.floor(monthDiff / step) * step;
        }

        for (; ;) {
            if (!beginIteration()) break;
            const year = Math.floor(monthIndex / 12);
            const month = (monthIndex % 12 + 12) % 12 + 1;
            const start = zonedTimeToUtcMsOrNull(year, month, dom, baseH, baseMin, baseS, tz, eventContext);

            if (start !== null) {
                const localParts = getPartsInTzHms(start, tz);
                const sameDay =
                    localParts.Y === year &&
                    localParts.M === month &&
                    localParts.D === dom &&
                    localParts.h === baseH &&
                    localParts.m === baseMin &&
                    localParts.sec === baseS;

                if (start > until) break;
                if (sameDay && !push(start, out)) break;
            }

            monthIndex += step;
            const nextYear = Math.floor(monthIndex / 12);
            const nextMonth = (monthIndex % 12 + 12) % 12 + 1;
            const nextStart = zonedTimeToUtcMsOrNull(nextYear, nextMonth, 1, 0, 0, 0, tz, eventContext);
            if (nextStart != null && nextStart > toUtc && nextStart > until) break;
        }
        return out;
    }

    if (ev.repeat === 'yearly') {
        let year = baseY;
        const fromLocal = getPartsInTz(fromUtc - Math.max(0, dur), tz);
        if (fromLocal.Y > year) {
            const yearDiff = fromLocal.Y - year;
            year += Math.floor(yearDiff / step) * step;
        }

        for (; ;) {
            if (!beginIteration()) break;
            const start = zonedTimeToUtcMsOrNull(year, baseM, baseD, baseH, baseMin, baseS, tz, eventContext);

            if (start !== null) {
                const localParts = getPartsInTzHms(start, tz);
                const sameDay =
                    localParts.Y === year &&
                    localParts.M === baseM &&
                    localParts.D === baseD &&
                    localParts.h === baseH &&
                    localParts.m === baseMin &&
                    localParts.sec === baseS;

                if (start > until) break;
                if (sameDay && !push(start, out)) break;
            }

            year += step;
            const nextStart = zonedTimeToUtcMsOrNull(year, 1, 1, 0, 0, 0, tz, eventContext);
            if (nextStart != null && nextStart > toUtc && nextStart > until) break;
        }
        return out;
    }

    return out;
}

export function expandAllInRange(evs: EventInput[], fromUtc: number, toUtc: number): UiOccurrence[] {
    const out: UiOccurrence[] = [];
    for (const ev of evs) {
        const remaining = MAX_OCCURRENCES_PER_REQUEST - out.length;
        if (remaining <= 0) {
            warn('occurrence', 'Recurrence expansion truncated by per-request occurrence limit', {
                eventCount: evs.length,
                fromUtc,
                toUtc,
                limit: MAX_OCCURRENCES_PER_REQUEST,
            });
            break;
        }
        out.push(...expandOccurrencesInRange(ev, fromUtc, toUtc, remaining));
    }
    out.sort((a, b) => a.startUtc - b.startUtc || a.occurrenceId.localeCompare(b.occurrenceId));
    return out;
}
