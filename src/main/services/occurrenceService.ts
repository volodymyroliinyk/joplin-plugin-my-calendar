import {IcsEvent} from '../types/icsTypes';
import {EventInput} from '../parsers/eventParser';
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
import {dbg} from '../utils/logger';

export type Occurrence = { start: Date; end: Date; recurrence_id?: string };

const WD_MAP_MON0: Record<string, number> = {MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6};

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function formatLocalYmdHms(msUtc: number, tz: string): string {
    const p = getPartsInTzHms(msUtc, tz);
    return `${p.Y}-${pad2(p.M)}-${pad2(p.D)} ${pad2(p.h)}:${pad2(p.m)}:${pad2(p.sec)}`;
}

function parseByWeekdaysStrToMon0(v?: string): number[] | undefined {
    if (!v) return undefined;
    const arr = v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const out: number[] = [];
    for (const t of arr) if (t in WD_MAP_MON0) out.push(WD_MAP_MON0[t]);
    return out.length ? out : undefined;
}

function parseByMonthDaySafe(v?: string): number | undefined {
    if (!v) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : undefined;
}

function parseTzSafe(tz?: string): string {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return fallback;
    try {
        new Intl.DateTimeFormat('en-US', {timeZone: tz}).format(new Date());
        return tz;
    } catch {
        return fallback;
    }
}

export function expandOccurrences(ev: IcsEvent, windowStart: Date, windowEnd: Date): Occurrence[] {
    if (!ev.start) return [];

    const tz = parseTzSafe(ev.tz);
    const baseLocal = parseYmdHmsLocal(ev.start);
    const startUtc = zonedTimeToUtcMs(baseLocal.Y, baseLocal.M, baseLocal.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);

    let endUtc: number;
    if (ev.end) {
        try {
            const endLocal = parseYmdHmsLocal(ev.end);
            endUtc = zonedTimeToUtcMs(endLocal.Y, endLocal.M, endLocal.D, endLocal.h, endLocal.m, endLocal.sec, tz);
        } catch {
            endUtc = startUtc;
        }
    } else {
        endUtc = startUtc;
    }

    let repeatUntilUtc: number | undefined;
    if (ev.repeat_until) {
        try {
            const untilLocal = parseYmdHmsLocal(ev.repeat_until);
            repeatUntilUtc = zonedTimeToUtcMs(
                untilLocal.Y,
                untilLocal.M,
                untilLocal.D,
                untilLocal.h,
                untilLocal.m,
                untilLocal.sec,
                tz
            );
        } catch { /* ignore */
        }
    }

    const eventInput: EventInput = {
        id: ev.uid || 'ics',
        title: ev.title || 'Event',
        startUtc,
        endUtc,
        tz,
        startText: formatLocalYmdHms(startUtc, tz),
        endText: ev.end,
        repeat: ev.repeat || 'none',
        repeatInterval: ev.repeat_interval && ev.repeat_interval >= 1 ? ev.repeat_interval : 1,
        repeatUntilUtc,
        byWeekdays: parseByWeekdaysStrToMon0(ev.byweekday),
        byMonthDay: parseByMonthDaySafe(ev.bymonthday),
    };

    const occs = expandOccurrencesInRange(eventInput, windowStart.getTime(), windowEnd.getTime());
    return occs.map((o: UiOccurrence) => ({
        start: new Date(o.startUtc),
        end: new Date(o.endUtc ?? o.startUtc),
        recurrence_id: undefined,
    }));
}

function expandOccurrencesInRange(ev: EventInput, fromUtc: number, toUtc: number): UiOccurrence[] {
    // Invariant: recurring events must have timezone
    const tz = ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (ev.repeat !== 'none' && !ev.tz) {
        dbg('occurrence', 'Recurring event has no timezone; using device timezone:', {tz, title: ev.title, id: ev.id});
    }

    const dur = (ev.endUtc ?? ev.startUtc) - ev.startUtc;
    const push = (start: number, out: UiOccurrence[]) => {
        if (start > toUtc) return false;
        const end = dur ? start + dur : start;
        if (end < fromUtc) return true;
        out.push({...ev, occurrenceId: `${ev.id}#${start}`, startUtc: start, endUtc: dur ? end : undefined});
        return true;
    };

    if (ev.repeat === 'none') {
        const end = ev.endUtc ?? ev.startUtc;
        if (end < fromUtc || ev.startUtc > toUtc) return [];
        return [{...ev, occurrenceId: `${ev.id}#${ev.startUtc}`}];
    }

    const out: UiOccurrence[] = [];
    const base = new Date(ev.startUtc);
    const baseY = base.getUTCFullYear(), baseM = base.getUTCMonth(), baseD = base.getUTCDate();
    const baseH = base.getUTCHours(), baseMin = base.getUTCMinutes(), baseS = base.getUTCSeconds();
    const until = ev.repeatUntilUtc ?? toUtc;
    const step = Math.max(1, ev.repeatInterval || 1);

    if (ev.repeat === 'daily') {
        const from2 = fromUtc - Math.max(0, dur);
        let k = Math.floor((from2 - ev.startUtc) / (DAY_MS * step));
        if (ev.startUtc + k * step * DAY_MS < from2) k++;
        if (k < 0) k = 0;
        for (; ; k++) {
            const start = ev.startUtc + k * step * DAY_MS;
            if (start > until) break;
            if (!push(start, out)) break;
        }
        return out;
    }

    if (ev.repeat === 'weekly') {
        const baseLocal = parseYmdHmsLocal(ev.startText);
        const baseWd = weekdayMon0(baseLocal.Y, baseLocal.M, baseLocal.D);

        const list = ev.byWeekdays && ev.byWeekdays.length ? ev.byWeekdays : [baseWd];
        const step = Math.max(1, ev.repeatInterval || 1);
        const from2 = fromUtc - Math.max(0, dur);

        // Monday of base week (local date)
        const mondayBase = addDaysYMD(baseLocal.Y, baseLocal.M, baseLocal.D, -baseWd);

        // Start from the week containing "fromUtc" in local TZ
        const fromLocal = getPartsInTz(fromUtc, tz);
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
            const weekStart = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, weekIndex * 7 * step);

            for (const wd of list) {
                const occ = addDaysYMD(weekStart.Y, weekStart.M, weekStart.D, wd);

                const start = zonedTimeToUtcMs(occ.Y, occ.M, occ.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                if (start < from2 || start > until) continue;

                if (!push(start, out)) return out;
            }

            // stop condition: next week start beyond range
            const nextWeek = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, (weekIndex + 1) * 7 * step);
            const nextWeekStartUtc = zonedTimeToUtcMs(nextWeek.Y, nextWeek.M, nextWeek.D, 0, 0, 0, tz);
            if (nextWeekStartUtc > toUtc) break;

            weekIndex++;
        }
        return out;
    }

    if (ev.repeat === 'monthly') {
        const dom = ev.byMonthDay ?? baseD;
        const y = baseY;
        let m = baseM;
        let cursor = Date.UTC(y, m, dom, baseH, baseMin, baseS);
        while (cursor < ev.startUtc) {
            m += 1;
            cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS);
        }
        for (; ;) {
            if (cursor > until) break;
            const cd = new Date(cursor);
            // Ensure month is what we expect (no overflow like Jan 31 -> Feb 3)
            const expectedM = (m % 12 + 12) % 12;
            if (cd.getUTCMonth() === expectedM) {
                if (!push(cursor, out)) break;
            }

            m += step;
            cursor = Date.UTC(y + Math.floor(m / 12), (m % 12 + 12) % 12, dom, baseH, baseMin, baseS);
            if (cursor > toUtc && cursor > until) break;
        }
        return out;
    }

    if (ev.repeat === 'yearly') {
        let y = baseY;
        let cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        while (cursor < ev.startUtc) {
            y += 1;
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        }
        while (cursor < fromUtc) {
            y += (step || 1);
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
        }
        for (; ;) {
            if (cursor > until) break;
            const dt = new Date(cursor);
            // Ensure month is still February (or whatever baseM was) - handles Leap Year Feb 29
            if (dt.getUTCMonth() === baseM) {
                if (!push(cursor, out)) break;
            }
            y += (step || 1);
            cursor = Date.UTC(y, baseM, baseD, baseH, baseMin, baseS);
            if (cursor > toUtc && cursor > until) break;
        }
        return out;
    }

    return out;
}

export function expandAllInRange(evs: EventInput[], fromUtc: number, toUtc: number): UiOccurrence[] {
    const out: UiOccurrence[] = [];
    for (const ev of evs) out.push(...expandOccurrencesInRange(ev, fromUtc, toUtc));
    out.sort((a, b) => a.startUtc - b.startUtc || a.occurrenceId.localeCompare(b.occurrenceId));
    return out;
}
