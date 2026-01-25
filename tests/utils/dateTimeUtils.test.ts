// tests/utils/dateTimeUtils.test.ts

import {
    parseIsoDurationToMs,
    addDays,
    addMonths,
    addYears,
    weekdayToJs,
    formatDateForAlarm,
    icsDateToMyCalText,
    computeAlarmWhen
} from '../../src/main/utils/dateTimeUtils';

describe('dateTimeUtils', () => {

    describe('parseIsoDurationToMs', () => {
        test('parses simple durations', () => {
            expect(parseIsoDurationToMs('PT1H')).toBe(3600000);
            expect(parseIsoDurationToMs('PT15M')).toBe(900000);
            expect(parseIsoDurationToMs('PT10S')).toBe(10000);
            expect(parseIsoDurationToMs('P1D')).toBe(86400000);
            expect(parseIsoDurationToMs('P1W')).toBe(604800000);
        });

        test('parses negative durations', () => {
            expect(parseIsoDurationToMs('-PT1H')).toBe(-3600000);
            expect(parseIsoDurationToMs('-P1D')).toBe(-86400000);
        });

        test('parses complex durations', () => {
            // 1 day, 2 hours, 3 minutes, 4 seconds
            const expected = ((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000;
            expect(parseIsoDurationToMs('P1DT2H3M4S')).toBe(expected);
        });

        test('returns null for invalid strings', () => {
            expect(parseIsoDurationToMs('invalid')).toBeNull();
            expect(parseIsoDurationToMs('1H')).toBeNull();
            expect(parseIsoDurationToMs('')).toBeNull();
        });
    });

    describe('date arithmetic', () => {
        test('addDays', () => {
            const d = new Date(Date.UTC(2025, 0, 1)); // Jan 1
            const next = addDays(d, 5);
            expect(next.getUTCDate()).toBe(6);
            expect(next.getUTCFullYear()).toBe(2025);
        });

        test('addMonths', () => {
            const d = new Date(Date.UTC(2025, 0, 1)); // Jan 1
            const next = addMonths(d, 1);
            expect(next.getUTCMonth()).toBe(1); // Feb

            const rollOver = addMonths(d, 13);
            expect(rollOver.getUTCFullYear()).toBe(2026);
            expect(rollOver.getUTCMonth()).toBe(1);
        });

        test('addYears', () => {
            const d = new Date(Date.UTC(2025, 0, 1));
            const next = addYears(d, 2);
            expect(next.getUTCFullYear()).toBe(2027);
        });
    });

    describe('weekdayToJs', () => {
        test('maps correctly', () => {
            expect(weekdayToJs('SU')).toBe(0);
            expect(weekdayToJs('MO')).toBe(1);
            expect(weekdayToJs('SA')).toBe(6);
            expect(weekdayToJs('XX')).toBeNull();
        });
    });

    describe('icsDateToMyCalText', () => {
        test('converts UTC iCalendar format', () => {
            expect(icsDateToMyCalText('20250115T100000Z')).toBe('2025-01-15 10:00:00+00:00');
        });

        test('converts floating date-time', () => {
            expect(icsDateToMyCalText('20250115T100000')).toBe('2025-01-15 10:00:00');
        });

        test('converts date-only', () => {
            expect(icsDateToMyCalText('20250115')).toBe('2025-01-15 00:00:00');
        });

        test('passes through ISO-like', () => {
            expect(icsDateToMyCalText('2025-01-15T10:00')).toBe('2025-01-15 10:00');
        });
    });

    describe('formatDateForAlarm', () => {
        test('formats to UTC string', () => {
            const d = new Date(Date.UTC(2025, 0, 15, 10, 30, 45));
            expect(formatDateForAlarm(d)).toBe('2025-01-15 10:30:45+00:00');
        });
    });

    describe('computeAlarmWhen', () => {
        const occ = {
            start: new Date(Date.UTC(2025, 0, 1, 10, 0, 0)),
            end: new Date(Date.UTC(2025, 0, 1, 12, 0, 0))
        };

        test('computes relative start', () => {
            const alarm = {trigger: '-PT1H', related: 'START' as const};
            const when = computeAlarmWhen(alarm, occ);
            expect(when?.toISOString()).toBe(new Date(Date.UTC(2025, 0, 1, 9, 0, 0)).toISOString());
        });

        test('computes relative end', () => {
            const alarm = {trigger: '-PT30M', related: 'END' as const};
            const when = computeAlarmWhen(alarm, occ);
            expect(when?.toISOString()).toBe(new Date(Date.UTC(2025, 0, 1, 11, 30, 0)).toISOString());
        });

        test('computes absolute trigger', () => {
            const alarm = {trigger: '20250101T080000Z'};
            const when = computeAlarmWhen(alarm, occ);
            expect(when?.toISOString()).toBe(new Date(Date.UTC(2025, 0, 1, 8, 0, 0)).toISOString());
        });
    });
});
