// tests/utils/dateUtils.test.ts
//
// src/main/utils/dateUtils.ts
//
// npx jest tests/utils/dateUtils.test.ts --runInBand --no-cache;
//

import {
    parseYmdHmsLocal,
    addDaysYMD,
    weekdayMon0,
    getPartsInTz,
    zonedTimeToUtcMs
} from '../../src/main/utils/dateUtils';

describe('dateUtils (recurrence helpers)', () => {

    test('parseYmdHmsLocal parses various formats', () => {
        expect(parseYmdHmsLocal('2025-01-15 10:00:00')).toEqual({Y: 2025, M: 1, D: 15, h: 10, m: 0, sec: 0});
        expect(parseYmdHmsLocal('2025-01-15')).toEqual({Y: 2025, M: 1, D: 15, h: 0, m: 0, sec: 0});
        expect(parseYmdHmsLocal('  2025-01-15  10:00  ')).toEqual({Y: 2025, M: 1, D: 15, h: 10, m: 0, sec: 0});
        expect(parseYmdHmsLocal('2025-01-15T10:00:00')).toEqual({Y: 2025, M: 1, D: 15, h: 10, m: 0, sec: 0});
    });

    test('parseYmdHmsLocal throws on invalid input', () => {
        expect(() => parseYmdHmsLocal('')).toThrow(/Invalid datetime format/);
        expect(() => parseYmdHmsLocal('2025-13-01')).toThrow(/month out of range/);
        expect(() => parseYmdHmsLocal('2025-02-30')).toThrow(/Invalid date/);
        expect(() => parseYmdHmsLocal('2025-01-01 25:00')).toThrow(/hour out of range/);
    });

    test('addDaysYMD handles month/year bounds', () => {
        expect(addDaysYMD(2025, 1, 31, 1)).toEqual({Y: 2025, M: 2, D: 1});
        expect(addDaysYMD(2025, 1, 1, -1)).toEqual({Y: 2024, M: 12, D: 31});
        expect(addDaysYMD(2024, 2, 28, 1)).toEqual({Y: 2024, M: 2, D: 29}); // Leap year
    });

    test('weekdayMon0: Mon=0, Sun=6', () => {
        expect(weekdayMon0(2025, 1, 13)).toBe(0); // Monday
        expect(weekdayMon0(2025, 1, 19)).toBe(6); // Sunday
    });

    test('getPartsInTz returns correct YMD for given TZ', () => {
        const ts = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01 00:00 UTC
        // In America/New_York (-5), it's 2024-12-31 19:00
        expect(getPartsInTz(ts, 'America/New_York')).toEqual({Y: 2024, M: 12, D: 31});
        expect(getPartsInTz(ts, 'UTC')).toEqual({Y: 2025, M: 1, D: 1});
    });

    test('zonedTimeToUtcMs handles DST spring-forward (existing times)', () => {
        // America/New_York DST starts March 10, 2024
        // 01:00 EST -> 06:00 UTC
        // 03:00 EDT -> 07:00 UTC

        const before = zonedTimeToUtcMs(2024, 3, 10, 1, 0, 0, 'America/New_York');
        const after = zonedTimeToUtcMs(2024, 3, 10, 3, 0, 0, 'America/New_York');

        expect(new Date(before).getUTCHours()).toBe(6);
        expect(new Date(after).getUTCHours()).toBe(7);
    });

    test('zonedTimeToUtcMs throws on DST spring-forward gap (non-existent local time)', () => {
        // 02:30 does not exist in America/New_York on 2024-03-10
        expect(() => zonedTimeToUtcMs(2024, 3, 10, 2, 30, 0, 'America/New_York')).toThrow(/Non-existent local time/);
    });

    test('zonedTimeToUtcMs resolves DST fall-back ambiguity by preference', () => {
        // America/New_York DST ends Nov 3, 2024. 01:30 happens twice:
        //  - earlier (EDT, UTC-4) => 05:30 UTC
        //  - later  (EST, UTC-5) => 06:30 UTC
        const earlier = zonedTimeToUtcMs(2024, 11, 3, 1, 30, 0, 'America/New_York', {prefer: 'earlier'});
        const later = zonedTimeToUtcMs(2024, 11, 3, 1, 30, 0, 'America/New_York', {prefer: 'later'});

        expect(new Date(earlier).toISOString()).toContain('T05:30:00.000Z');
        expect(new Date(later).toISOString()).toContain('T06:30:00.000Z');
    });
});
