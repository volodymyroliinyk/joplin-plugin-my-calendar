import {
    canonicalWeekdays,
    normalizeAllDayDateRange,
    normalizeIcsEvent,
    normalizeMonthDay,
    normalizeRecurrenceExceptionDate,
    normalizeRepeatFrequency,
    normalizeRepeatInterval,
    normalizeTimeZone,
    normalizeWeekdayIndices,
    parseCalendarBoolean,
    toInclusiveAllDayEndUtc,
} from '../../src/main/services/calendarEventNormalizer';

describe('calendarEventNormalizer', () => {
    test('normalizes timezone, repeat, interval, weekday, and month-day rules', () => {
        expect(normalizeTimeZone(' America/Toronto ')).toBe('America/Toronto');
        expect(normalizeTimeZone('Mars/Base')).toBeUndefined();
        expect(normalizeRepeatFrequency(' WEEKLY ')).toBe('weekly');
        expect(normalizeRepeatFrequency('sometimes')).toBe('none');
        expect(normalizeRepeatInterval('2.9', 999)).toBe(2);
        expect(normalizeRepeatInterval(-5, 999)).toBe(1);
        expect(normalizeMonthDay('31')).toBe(31);
        expect(normalizeMonthDay('32')).toBeUndefined();
        expect(normalizeWeekdayIndices('WE,MO,WE,XX')).toEqual([0, 2]);
        expect(canonicalWeekdays('WE,MO,WE')).toBe('MO,WE');
        expect(() => canonicalWeekdays('MO,XX', true)).toThrow('Invalid weekday: XX');
    });

    test('normalizes calendar booleans and all-day ranges consistently', () => {
        expect(parseCalendarBoolean('yes')).toBe(true);
        expect(parseCalendarBoolean('0')).toBe(false);
        expect(parseCalendarBoolean('sometimes')).toBeUndefined();
        expect(normalizeAllDayDateRange('2026-06-16', '')).toEqual({
            start: '2026-06-16',
            end: '2026-06-17',
        });
        expect(normalizeAllDayDateRange('2026-06-16', '2026-06-18')).toEqual({
            start: '2026-06-16',
            end: '2026-06-19',
        });
        expect(toInclusiveAllDayEndUtc(1_000, 2_000)).toBe(1_999);
        expect(toInclusiveAllDayEndUtc(1_000, 500)).toBe(86_400_999);
    });

    test.each([
        ['DATE:20250122', '2025-01-22 00:00:00'],
        ['America/Toronto:20250122T090000', '2025-01-22 09:00:00'],
        ['20250122T140000Z', '2025-01-22 14:00:00+00:00'],
    ])('normalizes recurrence exception %s', (input, expected) => {
        expect(normalizeRecurrenceExceptionDate(input)).toBe(expected);
    });

    test('produces an immutable canonical ICS event', () => {
        const source = {
            uid: ' uid-1 ',
            recurrence_id: ' rid-1 ',
            tz: 'America/Toronto',
            repeat: 'weekly' as const,
            repeat_interval: 0,
            byweekday: 'WE,MO,WE',
            bymonthday: '99',
            exdates: [' 2025-01-22 09:00:00 ', '2025-01-22 09:00:00'],
            valarms: [{trigger: '-PT15M'}],
        };

        const normalized = normalizeIcsEvent(source);

        expect(normalized).toMatchObject({
            uid: 'uid-1',
            recurrence_id: 'rid-1',
            repeat: 'weekly',
            repeat_interval: 1,
            byweekday: 'MO,WE',
            exdates: ['2025-01-22 09:00:00'],
        });
        expect(normalized.bymonthday).toBeUndefined();
        expect(normalized.valarms).not.toBe(source.valarms);
        expect(source.uid).toBe(' uid-1 ');
    });
});
