// src/main/utils/dateUtils.ts

import {EventInput} from '../parsers/eventParser';

export type Occurrence = EventInput & { occurrenceId: string; startUtc: number; endUtc?: number };

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseYmdHmsLocal(s: string): { Y: number; M: number; D: number; h: number; m: number; sec: number } {
    // "2025-09-01 15:30:00"
    const [d, t] = s.trim().split(/\s+/);
    const [Y, M, D] = d.split('-').map(n => parseInt(n, 10));
    const [h, m, sec] = (t || '00:00:00').split(':').map(n => parseInt(n, 10));
    return {Y, M, D, h, m, sec: sec || 0};
}

export function addDaysYMD(Y: number, M: number, D: number, deltaDays: number): { Y: number; M: number; D: number } {
    const dt = new Date(Date.UTC(Y, M - 1, D) + deltaDays * DAY_MS);
    return {Y: dt.getUTCFullYear(), M: dt.getUTCMonth() + 1, D: dt.getUTCDate()};
}

export function weekdayMon0(Y: number, M: number, D: number): number {
    // Monday=0..Sunday=6
    const dowSun0 = new Date(Date.UTC(Y, M - 1, D)).getUTCDay(); // Sun=0
    return (dowSun0 + 6) % 7;
}

export function getPartsInTz(msUtc: number, tz: string): { Y: number; M: number; D: number } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(new Date(msUtc));
    const mp: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') mp[p.type] = p.value;
    return {Y: Number(mp.year), M: Number(mp.month), D: Number(mp.day)};
}

// Convert "local datetime in tz" -> UTC ms (handles DST correctly for that date)
export function zonedTimeToUtcMs(localY: number, localM: number, localD: number, localH: number, localMin: number, localSec: number, tz: string): number {
    const getUtcMsAtZoned = (utcGuess: number): number => {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        });
        const parts = fmt.formatToParts(new Date(utcGuess));
        const mp: Record<string, string> = {};
        for (const p of parts) if (p.type !== 'literal') mp[p.type] = p.value;

        return Date.UTC(
            Number(mp.year),
            Number(mp.month) - 1,
            Number(mp.day),
            Number(mp.hour),
            Number(mp.minute),
            Number(mp.second),
        );
    };

    const wantAsUtc = Date.UTC(localY, localM - 1, localD, localH, localMin, localSec);

    // Pass 1
    const guess = wantAsUtc;
    const got1 = getUtcMsAtZoned(guess);
    const off1 = got1 - guess;
    let utc = wantAsUtc - off1;

    // Pass 2
    const got2 = getUtcMsAtZoned(utc);
    const off2 = got2 - utc;
    if (off1 !== off2) {
        utc = wantAsUtc - off2;
    }

    return utc;
}
