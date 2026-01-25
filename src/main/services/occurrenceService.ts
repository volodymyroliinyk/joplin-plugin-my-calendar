// src/main/services/occurrenceService.ts

import {IcsEvent} from '../types/icsTypes';
import {addDays, addMonths, addYears, parseMyCalDateToDate, weekdayToJs} from '../utils/dateTimeUtils';

export type Occurrence = { start: Date; end: Date; recurrence_id?: string };

export function expandOccurrences(ev: IcsEvent, windowStart: Date, windowEnd: Date): Occurrence[] {
    const start = parseMyCalDateToDate(ev.start);
    if (!start) return [];
    const end = parseMyCalDateToDate(ev.end) ?? new Date(start.getTime());
    const durMs = end.getTime() - start.getTime();

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
            cur = addDays(cur, interval);
        }
        return occs;
    }

    if (ev.repeat === 'weekly') {
        const days = (ev.byweekday ? ev.byweekday.split(',') : []).map(d => d.trim()).filter(Boolean);
        const jsDays = (days.length ? days : [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][start.getDay()]])
            .map(weekdayToJs)
            .filter((n): n is number => n !== null)
            .sort((a, b) => a - b);

        let weekAnchor = new Date(start.getTime());
        while (weekAnchor.getTime() <= hardEnd.getTime()) {
            for (const wd of jsDays) {
                const s = new Date(weekAnchor.getTime());
                const delta = wd - s.getDay();
                s.setDate(s.getDate() + delta);
                s.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
                if (s.getTime() < weekAnchor.getTime()) s.setDate(s.getDate() + 7);
                if (s.getTime() < start.getTime()) continue;
                pushIfInRange(s);
            }
            weekAnchor = addDays(weekAnchor, 7 * interval);
        }
        return occs;
    }

    if (ev.repeat === 'monthly') {
        let cur = new Date(start.getTime());
        const day = ev.bymonthday ? parseInt(ev.bymonthday, 10) : start.getDate();
        while (cur.getTime() <= hardEnd.getTime()) {
            const s = new Date(cur.getTime());
            s.setDate(day);
            s.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
            if (s.getTime() < start.getTime()) {
                cur = addMonths(cur, interval);
                continue;
            }
            pushIfInRange(s);
            cur = addMonths(cur, interval);
        }
        return occs;
    }

    if (ev.repeat === 'yearly') {
        let cur = new Date(start.getTime());
        while (cur.getTime() <= hardEnd.getTime()) {
            pushIfInRange(cur);
            cur = addYears(cur, interval);
        }
        return occs;
    }

    return occs;
}
