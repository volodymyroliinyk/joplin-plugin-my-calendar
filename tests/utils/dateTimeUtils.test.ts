// tests/utils/dateTimeUtils.test.ts
//
// src/main/utils/dateTimeUtils.ts
//
// npx jest tests/utils/dateTimeUtils.test.ts --runInBand --no-cache;
//
import {
    parseIsoDurationToMs,
    parseMyCalDateToDate,
    formatAlarmTitleTime,
    formatTriggerDescription,
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

        test('parses negative and positive sign durations and trimming/lowercase', () => {
            expect(parseIsoDurationToMs('-pt1h')).toBe(-3600000);
            expect(parseIsoDurationToMs('+P1D')).toBe(86400000);
            expect(parseIsoDurationToMs('  -P1W  ')).toBe(-604800000);
        });

        test('parses complex durations', () => {
            // 1 week, 1 day, 2 hours, 3 minutes, 4 seconds
            const expected = ((8 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000;
            expect(parseIsoDurationToMs('P1W1DT2H3M4S')).toBe(expected);
        });

        test('returns null for invalid strings', () => {
            expect(parseIsoDurationToMs('invalid')).toBeNull();
            expect(parseIsoDurationToMs('1H')).toBeNull();
            expect(parseIsoDurationToMs('')).toBeNull();
            expect(parseIsoDurationToMs('P')).toBeNull();
            expect(parseIsoDurationToMs('PT')).toBeNull();
        });
    });

    describe('parseMyCalDateToDate', () => {
        test('parses with space separator and timezone offset', () => {
            const d = parseMyCalDateToDate('2025-01-01 08:00:00+00:00');
            expect(d?.toISOString()).toBe(new Date(Date.UTC(2025, 0, 1, 8, 0, 0)).toISOString());
        });

        test('returns null for empty/invalid', () => {
            expect(parseMyCalDateToDate()).toBeNull();
            expect(parseMyCalDateToDate('   ')).toBeNull();
            expect(parseMyCalDateToDate('not-a-date')).toBeNull();
        });
    });

    describe('formatAlarmTitleTime', () => {
        test('formats local title time (shape only)', () => {
            const d = new Date(Date.UTC(2025, 0, 15, 10, 30, 45));
            // Do not assert exact hour because this is LOCAL time.
            expect(formatAlarmTitleTime(d)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        });
    });

    describe('formatTriggerDescription', () => {
        test('describes relative durations', () => {
            expect(formatTriggerDescription('-PT15M')).toBe('15 minutes before');
            expect(formatTriggerDescription('PT15M')).toBe('15 minutes after');
            expect(formatTriggerDescription('PT0S')).toBe('at time of event');
        });

        test('describes absolute triggers', () => {
            expect(formatTriggerDescription('20250101T080000Z')).toBe('at specific time');
        });

        test('passes through invalid duration as-is (uppercased by implementation)', () => {
            expect(formatTriggerDescription('P1X')).toBe('P1X');
        });
    });

    describe('date arithmetic (UTC-safe)', () => {
        test('addDays', () => {
            const d = new Date(Date.UTC(2025, 0, 1, 10, 0, 0)); // Jan 1 10:00Z
            const next = addDays(d, 5);
            expect(next.toISOString()).toBe(new Date(Date.UTC(2025, 0, 6, 10, 0, 0)).toISOString());
        });

        test('addMonths', () => {
            const d = new Date(Date.UTC(2025, 0, 1, 10, 0, 0)); // Jan 1
            const next = addMonths(d, 1);
            expect(next.toISOString()).toBe(new Date(Date.UTC(2025, 1, 1, 10, 0, 0)).toISOString());

            const rollOver = addMonths(d, 13);
            expect(rollOver.toISOString()).toBe(new Date(Date.UTC(2026, 1, 1, 10, 0, 0)).toISOString());
        });

        test('addYears', () => {
            const d = new Date(Date.UTC(2025, 0, 1, 10, 0, 0));
            const next = addYears(d, 2);
            expect(next.toISOString()).toBe(new Date(Date.UTC(2027, 0, 1, 10, 0, 0)).toISOString());
        });
    });

    describe('weekdayToJs', () => {
        test('maps correctly', () => {
            expect(weekdayToJs('SU')).toBe(0);
            expect(weekdayToJs(' MO ')).toBe(1);
            expect(weekdayToJs('SA')).toBe(6);
            expect(weekdayToJs('XX')).toBeNull();
        });
    });

    describe('icsDateToMyCalText', () => {
        test('converts UTC iCalendar format', () => {
            expect(icsDateToMyCalText('20250115T100000Z')).toBe('2025-01-15 10:00:00+00:00');
        });
        test('accepts lowercase z', () => {
            expect(icsDateToMyCalText('20250115T100000z')).toBe('2025-01-15 10:00:00+00:00');
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

        test('returns undefined for unknown formats', () => {
            expect(icsDateToMyCalText('')).toBeUndefined();
            expect(icsDateToMyCalText('not-a-date')).toBeUndefined();
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

        test('returns null for invalid triggers', () => {
            expect(computeAlarmWhen({trigger: 'not-a-trigger'}, occ)).toBeNull();
            expect(computeAlarmWhen({trigger: ''}, occ)).toBeNull();
        });
    });
});
