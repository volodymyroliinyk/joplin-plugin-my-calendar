// src/main/utils/dateUtils.ts

import {EventInput} from '../parsers/eventParser';

export type Occurrence = EventInput & { occurrenceId: string; startUtc: number; endUtc?: number };

export const DAY_MS = 24 * 60 * 60 * 1000;

export type YmdHms = { Y: number; M: number; D: number; h: number; m: number; sec: number };

const YMD_HMS_RE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?(?:\s*[+-]\d{2}:?\d{2}|\s*Z)?\s*$/i;

function assertIntInRange(name: string, v: number, min: number, max: number): void {
    if (!Number.isInteger(v) || v < min || v > max) {
        throw new Error(`${name} out of range: ${v}`);
    }
}

function isValidUtcDate(Y: number, M: number, D: number): boolean {
    const dt = new Date(Date.UTC(Y, M - 1, D));
    return dt.getUTCFullYear() === Y && dt.getUTCMonth() + 1 === M && dt.getUTCDate() === D;
}

export function parseYmdHmsLocal(s: string): YmdHms {
    // Accepts:
    //  - "2025-09-01"
    //  - "2025-09-01 15:30"
    //  - "2025-09-01 15:30:00"
    //  - "2025-09-01T15:30:00"
    const m = s.match(YMD_HMS_RE);
    if (!m) throw new Error(`Invalid datetime format: "${s}"`);

    const Y = Number(m[1]);
    const M = Number(m[2]);
    const D = Number(m[3]);
    const h = m[4] != null ? Number(m[4]) : 0;
    const min = m[5] != null ? Number(m[5]) : 0;
    const sec = m[6] != null ? Number(m[6]) : 0;

    assertIntInRange('year', Y, 1, 9999);
    assertIntInRange('month', M, 1, 12);
    assertIntInRange('day', D, 1, 31);
    assertIntInRange('hour', h, 0, 23);
    assertIntInRange('minute', min, 0, 59);
    assertIntInRange('second', sec, 0, 59);

    if (!isValidUtcDate(Y, M, D)) {
        throw new Error(`Invalid date: ${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`);
    }

    return {Y, M, D, h, m: min, sec};
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
    const mp = formatToNumberParts(getFmtYmd(tz), msUtc);
    return {Y: mp.year, M: mp.month, D: mp.day};
}

export function getPartsInTzHms(msUtc: number, tz: string): {
    Y: number;
    M: number;
    D: number;
    h: number;
    m: number;
    sec: number
} {
    const mp = formatToNumberParts(getFmtYmdHms(tz), msUtc);
    return {Y: mp.year, M: mp.month, D: mp.day, h: mp.hour, m: mp.minute, sec: mp.second};
}

const fmtYmdByTz = new Map<string, Intl.DateTimeFormat>();
const fmtYmdHmsByTz = new Map<string, Intl.DateTimeFormat>();

function getFmtYmd(tz: string): Intl.DateTimeFormat {
    const cached = fmtYmdByTz.get(tz);
    if (cached) return cached;
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: false,
    });
    fmtYmdByTz.set(tz, fmt);
    return fmt;
}

function getFmtYmdHms(tz: string): Intl.DateTimeFormat {
    const cached = fmtYmdHmsByTz.get(tz);
    if (cached) return cached;
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    fmtYmdHmsByTz.set(tz, fmt);
    return fmt;
}

function formatToNumberParts(fmt: Intl.DateTimeFormat, msUtc: number): Record<string, number> {
    const parts = fmt.formatToParts(new Date(msUtc));
    const mp: Record<string, number> = {};
    for (const p of parts) {
        if (p.type !== 'literal') mp[p.type] = Number(p.value);
    }
    return mp;
}

export type ZonedToUtcOptions = {
    /**
     * When the local wall-clock time is ambiguous (DST "fall back"), select which instant to use.
     * Default: 'earlier'
     */
    prefer?: 'earlier' | 'later';
};

/**
 * Convert "local datetime in tz" -> UTC ms.
 *
 * Notes:
 * - If the local time does not exist (DST "spring forward" gap), this function throws.
 * - If the local time is ambiguous (DST "fall back"), it picks the 'earlier' instant by default.
 */
export function zonedTimeToUtcMs(
    localY: number,
    localM: number,
    localD: number,
    localH: number,
    localMin: number,
    localSec: number,
    tz: string,
    opts: ZonedToUtcOptions = {},
): number {
    const prefer = opts.prefer ?? 'earlier';

    const wantAsUtc = Date.UTC(localY, localM - 1, localD, localH, localMin, localSec);

    const getAsUtcMsAtZoned = (utcMs: number): number => {
        const mp = formatToNumberParts(getFmtYmdHms(tz), utcMs);
        return Date.UTC(mp.year, mp.month - 1, mp.day, mp.hour, mp.minute, mp.second);
    };

    const getOffsetMsAtUtc = (utcMs: number): number => getAsUtcMsAtZoned(utcMs) - utcMs;

    const buildCandidate = (offsetMs: number): number => wantAsUtc - offsetMs;

    // Two-pass (usually enough).
    const off1 = getOffsetMsAtUtc(wantAsUtc);
    const utc1 = buildCandidate(off1);
    const off2 = getOffsetMsAtUtc(utc1);
    const utc2 = buildCandidate(off2);

    const mp2 = formatToNumberParts(getFmtYmdHms(tz), utc2);
    const matches =
        mp2.year === localY &&
        mp2.month === localM &&
        mp2.day === localD &&
        mp2.hour === localH &&
        mp2.minute === localMin &&
        mp2.second === localSec;

    if (matches) {
        // Handle potential DST "fall back" ambiguity:
        // if there are multiple UTC instants that map to the same local wall-clock time,
        // pick earlier/later based on preference.
        const matchesLocal = (utcMs: number): boolean => {
            const mp = formatToNumberParts(getFmtYmdHms(tz), utcMs);
            return (
                mp.year === localY &&
                mp.month === localM &&
                mp.day === localD &&
                mp.hour === localH &&
                mp.minute === localMin &&
                mp.second === localSec
            );
        };

        const HOUR_MS = 60 * 60 * 1000;
        const candidates = new Set<number>([utc2]);

        // ±1h is sufficient for most DST overlaps; ±2h is a small safety net for rare zones.
        for (const d of [-2 * HOUR_MS, -HOUR_MS, HOUR_MS, 2 * HOUR_MS]) {
            const u = utc2 + d;
            if (matchesLocal(u)) candidates.add(u);
        }

        if (candidates.size === 1) return utc2;

        const arr = Array.from(candidates).sort((a, b) => a - b);
        return prefer === 'earlier' ? arr[0] : arr[arr.length - 1];
    }

    throw new Error(
        `Non-existent local time in ${tz}: ${localY}-${String(localM).padStart(2, '0')}-${String(localD).padStart(
            2,
            '0',
        )} ${String(localH).padStart(2, '0')}:${String(localMin).padStart(2, '0')}:${String(localSec).padStart(
            2,
            '0',
        )}`,
    );
}
