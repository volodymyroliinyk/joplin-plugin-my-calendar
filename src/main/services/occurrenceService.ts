// src/main/services/occurrenceService.ts

import {IcsEvent} from '../types/icsTypes';
import {parseMyCalDateToDate, weekdayToJs} from '../utils/dateTimeUtils';

export type Occurrence = { start: Date; end: Date; recurrence_id?: string };

export function expandOccurrences(ev: IcsEvent, windowStart: Date, windowEnd: Date): Occurrence[] {
    const start = parseMyCalDateToDate(ev.start);
    if (!start) return [];
    const end = parseMyCalDateToDate(ev.end) ?? new Date(start.getTime());
    const durMs = end.getTime() - start.getTime();


    // --- UTC helpers (avoid DST/local timezone shifts) ---
    const addDaysUtc = (d: Date, days: number): Date => {
        const out = new Date(d.getTime());
        out.setUTCDate(out.getUTCDate() + days);
        return out;
    };
    const addMonthsUtc = (d: Date, months: number): Date => {
        const out = new Date(d.getTime());
        out.setUTCMonth(out.getUTCMonth() + months);
        return out;
    };
    // const addYearsUtc = (d: Date, years: number): Date => {
    //     const out = new Date(d.getTime());
    //     out.setUTCFullYear(out.getUTCFullYear() + years);
    //     return out;
    // };
    const setTimeOfDayUtc = (d: Date, base: Date): void => {
        d.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), 0);
    };

    const until = parseMyCalDateToDate(ev.repeat_until);
    const hardEnd = until && until.getTime() < windowEnd.getTime() ? until : windowEnd;

    const interval = ev.repeat_interval && ev.repeat_interval >= 1 ? ev.repeat_interval : 1;

    const occs: Occurrence[] = [];

    const pushIfInRange = (s: Date) => {
        const e = new Date(s.getTime() + durMs);
        if (s.getTime() > hardEnd.getTime()) return;
        if (e.getTime() < windowStart.getTime()) return;
        if (s.getTime() > windowEnd.getTime()) return;
        occs.push({start: s, end: e, recurrence_id: undefined});
    };

    if (!ev.repeat || ev.repeat === 'none') {
        pushIfInRange(start);
        return occs;
    }

    if (ev.repeat === 'daily') {
        let cur = new Date(start.getTime());
        while (cur.getTime() <= hardEnd.getTime()) {
            pushIfInRange(cur);
            cur = addDaysUtc(cur, interval);
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'weekly') {
        const days = (ev.byweekday ? ev.byweekday.split(',') : []).map(d => d.trim()).filter(Boolean);
        const jsDays = (days.length ? days : [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][start.getUTCDay()]])
            .map(weekdayToJs)
            .filter((n): n is number => n !== null)
            .sort((a, b) => a - b);

        let weekAnchor = new Date(start.getTime());
        while (weekAnchor.getTime() <= hardEnd.getTime()) {
            for (const wd of jsDays) {
                const s = new Date(weekAnchor.getTime());
                const delta = wd - s.getUTCDay();
                s.setUTCDate(s.getUTCDate() + delta);
                setTimeOfDayUtc(s, start);
                if (s.getTime() < weekAnchor.getTime()) s.setUTCDate(s.getUTCDate() + 7);

                if (s.getTime() < start.getTime()) continue;
                pushIfInRange(s);
            }
            weekAnchor = addDaysUtc(weekAnchor, 7 * interval);
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'monthly') {
        const day = ev.bymonthday ? parseInt(ev.bymonthday, 10) : start.getUTCDate();
        // Anchor on the 1st of the month to avoid "rolling" when adding months
        let anchor = new Date(start.getTime());
        anchor.setUTCDate(1);
        while (anchor.getTime() <= hardEnd.getTime()) {
            const targetMonth = anchor.getUTCMonth();
            const s = new Date(anchor.getTime());
            s.setUTCDate(day);
            setTimeOfDayUtc(s, start);
            // If day does not exist in this month, JS will "roll" the date to another month.
            // According to the expected behavior of the RRULE, such instances should be skipped.
            if (s.getUTCMonth() === targetMonth) {
                if (s.getTime() >= start.getTime()) pushIfInRange(s);
            }
            anchor = addMonthsUtc(anchor, interval);
            anchor.setUTCDate(1);
        }
        return sortAndDedupe(occs);
    }

    if (ev.repeat === 'yearly') {
        const baseMonth = start.getUTCMonth();
        const baseDay = start.getUTCDate();
        const h = start.getUTCHours();
        const m = start.getUTCMinutes();
        const sec = start.getUTCSeconds();

        let year = start.getFullYear();
        while (true) {
            const s = new Date(start.getTime());
            s.setFullYear(year);
            s.setUTCHours(h, m, sec, 0);

            // February 29 will "roll over" in a non-leap year - we skip such instances
            if (s.getUTCMonth() === baseMonth && s.getUTCDate() === baseDay) {
                if (s.getTime() > hardEnd.getTime()) break;
                pushIfInRange(s);
            } else {
                // even if the date is invalid, a hardEnd stop is still required
                // we make a conservative check: if we have already "jumped" far ahead
                if (s.getTime() > hardEnd.getTime() && year !== start.getFullYear()) break;
            }

            year += interval;
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
