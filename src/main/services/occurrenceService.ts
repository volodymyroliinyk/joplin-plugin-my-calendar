import {IcsEvent} from '../types/icsTypes';
import {
    parseYmdHmsLocal,
    zonedTimeToUtcMs,
    addDaysYMD,
    getPartsInTz,
    weekdayMon0,
    DAY_MS
} from '../utils/dateUtils';

export type Occurrence = { start: Date; end: Date; recurrence_id?: string };

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

    const durMs = endUtc - startUtc;

    let hardEndUtc = windowEnd.getTime();
    if (ev.repeat_until) {
        try {
            const untilLocal = parseYmdHmsLocal(ev.repeat_until);
            const untilUtc = zonedTimeToUtcMs(untilLocal.Y, untilLocal.M, untilLocal.D, untilLocal.h, untilLocal.m, untilLocal.sec, tz);
            if (untilUtc < hardEndUtc) hardEndUtc = untilUtc;
        } catch { /* ignore */
        }
    }

    const interval = ev.repeat_interval && ev.repeat_interval >= 1 ? ev.repeat_interval : 1;
    const occs: Occurrence[] = [];

    const pushIfInRange = (sUtc: number) => {
        const eUtc = sUtc + durMs;
        if (sUtc > hardEndUtc) return;
        if (eUtc < windowStart.getTime()) return;
        if (sUtc > windowEnd.getTime()) return;
        occs.push({start: new Date(sUtc), end: new Date(eUtc), recurrence_id: undefined});
    };

    if (!ev.repeat || ev.repeat === 'none') {
        pushIfInRange(startUtc);
        return occs;
    }

    if (ev.repeat === 'daily') {
        const curLocal = {Y: baseLocal.Y, M: baseLocal.M, D: baseLocal.D};
        let k = 0;
        while (true) {
            const occ = addDaysYMD(curLocal.Y, curLocal.M, curLocal.D, k * interval);
            try {
                const s = zonedTimeToUtcMs(occ.Y, occ.M, occ.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                if (s > hardEndUtc && s > windowEnd.getTime()) break;
                pushIfInRange(s);
            } catch { /* skip non-existent hours during DST spring forward */
            }
            k++;
            if (k > 5000) break; // safety
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'weekly') {
        const days = (ev.byweekday ? ev.byweekday.split(',') : []).map(d => d.trim()).filter(Boolean);
        const wdBase = weekdayMon0(baseLocal.Y, baseLocal.M, baseLocal.D);

        // Convert WD strings to Mon=0 indices
        const WD_MAP_MON0: Record<string, number> = {MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6};
        const targetDays = (days.length ? days.map(d => WD_MAP_MON0[d.toUpperCase()]) : [wdBase])
            .filter((n): n is number => typeof n === 'number')
            .sort((a, b) => a - b);

        const mondayBase = addDaysYMD(baseLocal.Y, baseLocal.M, baseLocal.D, -wdBase);

        // Optimization: start from the week containing windowStart
        const winStartLocal = getPartsInTz(windowStart.getTime(), tz);
        const wdWinStart = weekdayMon0(winStartLocal.Y, winStartLocal.M, winStartLocal.D);
        const mondayWinStart = addDaysYMD(winStartLocal.Y, winStartLocal.M, winStartLocal.D, -wdWinStart);

        const mondayBaseMs = Date.UTC(mondayBase.Y, mondayBase.M - 1, mondayBase.D);
        const mondayWinStartMs = Date.UTC(mondayWinStart.Y, mondayWinStart.M - 1, mondayWinStart.D);

        const weeksDiff = Math.floor((mondayWinStartMs - mondayBaseMs) / (7 * DAY_MS));
        let weekIndex = Math.max(0, Math.floor(weeksDiff / interval));

        while (true) {
            const weekStart = addDaysYMD(mondayBase.Y, mondayBase.M, mondayBase.D, weekIndex * interval * 7);
            let allPastEnd = true;

            for (const wd of targetDays) {
                const occ = addDaysYMD(weekStart.Y, weekStart.M, weekStart.D, wd);
                try {
                    const s = zonedTimeToUtcMs(occ.Y, occ.M, occ.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                    if (s < startUtc) continue;
                    if (s <= hardEndUtc && s <= windowEnd.getTime()) {
                        pushIfInRange(s);
                    }
                    if (s <= windowEnd.getTime()) allPastEnd = false;
                } catch { /* DST gap */
                }
            }

            if (allPastEnd && weekIndex > 0) break;
            weekIndex++;
            if (weekIndex > 1000) break; // safety
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'monthly') {
        const day = ev.bymonthday ? parseInt(ev.bymonthday, 10) : baseLocal.D;
        let mIdx = 0;
        while (true) {
            const y = baseLocal.Y + Math.floor((baseLocal.M - 1 + mIdx * interval) / 12);
            const m = (baseLocal.M - 1 + mIdx * interval) % 12 + 1;

            // Check if day exists in month
            const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
            if (day <= lastDay) {
                try {
                    const s = zonedTimeToUtcMs(y, m, day, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                    if (s > hardEndUtc && s > windowEnd.getTime()) break;
                    if (s >= startUtc) pushIfInRange(s);
                } catch { /* skip non-existent hour */
                }
            }
            mIdx++;
            if (mIdx > 1000) break; // safety
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'yearly') {
        let yIdx = 0;
        while (true) {
            const y = baseLocal.Y + yIdx * interval;
            // Handle Feb 29
            const lastDay = new Date(Date.UTC(y, baseLocal.M, 0)).getUTCDate();
            if (baseLocal.D <= lastDay) {
                try {
                    const s = zonedTimeToUtcMs(y, baseLocal.M, baseLocal.D, baseLocal.h, baseLocal.m, baseLocal.sec, tz);
                    if (s > hardEndUtc && s > windowEnd.getTime()) break;
                    if (s >= startUtc) pushIfInRange(s);
                } catch { /* skip non-existent hour */
                }
            }
            yIdx++;
            if (yIdx > 200) break; // safety
        }
        return sortAndDedupe(occs);
    }

    return sortAndDedupe(occs);
}

function sortAndDedupe(list: Occurrence[]): Occurrence[] {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
    const out: Occurrence[] = [];
    let prev: number | null = null;
    for (const o of sorted) {
        const t = o.start.getTime();
        if (prev === t) continue;
        out.push(o);
        prev = t;
    }
    return out;
}
