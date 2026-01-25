import {
    parseYmdHmsLocal,
    addDaysYMD,
    weekdayMon0,
    getPartsInTz,
    zonedTimeToUtcMs
} from '../../src/main/utils/dateUtils';

describe('pluginMain helpers (dateUtils)', () => {

    test('parseYmdHmsLocal parses various formats', () => {
        expect(parseYmdHmsLocal('2025-01-15 10:00:00')).toEqual({Y: 2025, M: 1, D: 15, h: 10, m: 0, sec: 0});
        expect(parseYmdHmsLocal('2025-01-15')).toEqual({Y: 2025, M: 1, D: 15, h: 0, m: 0, sec: 0});
        expect(parseYmdHmsLocal('  2025-01-15  10:00  ')).toEqual({Y: 2025, M: 1, D: 15, h: 10, m: 0, sec: 0});
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

    test('zonedTimeToUtcMs handles DST', () => {
        // America/New_York DST starts March 10, 2024
        // 01:00 EST -> 06:00 UTC
        // 03:00 EDT -> 07:00 UTC

        const before = zonedTimeToUtcMs(2024, 3, 10, 1, 0, 0, 'America/New_York');
        const after = zonedTimeToUtcMs(2024, 3, 10, 3, 0, 0, 'America/New_York');

        expect(new Date(before).getUTCHours()).toBe(6);
        expect(new Date(after).getUTCHours()).toBe(7);
    });
});
