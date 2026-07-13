import {parseEventsFromBody, parseRepeatUntilToUTC} from '../../src/main/parsers/eventParser';

describe('eventParser.parseEventsFromBody', () => {
    test('parses repeated exdate lines from mycalendar-event block', () => {
        const body = [
            '```mycalendar-event',
            'title: Series',
            'start: 2025-01-15 09:00:00',
            'tz: America/Toronto',
            'repeat: weekly',
            'repeat_interval: 1',
            'exdate: 2025-01-22 09:00:00',
            'exdate: 2025-01-29 09:00:00',
            '',
            'uid: u1',
            '```',
        ].join('\n');

        const events = parseEventsFromBody('note-1', 'Fallback', body);

        expect(events).toHaveLength(1);
        expect(events[0].exdates).toEqual([
            '2025-01-22 09:00:00',
            '2025-01-29 09:00:00',
        ]);
    });

    test('normalizes duplicated and unsorted byweekday values', () => {
        const body = [
            '```mycalendar-event',
            'title: Series',
            'start: 2025-01-15 09:00:00',
            'tz: America/Toronto',
            'repeat: weekly',
            'byweekday: WE,MO,WE,XX',
            '',
            'uid: u2',
            '```',
        ].join('\n');

        const events = parseEventsFromBody('note-1', 'Fallback', body);

        expect(events).toHaveLength(1);
        expect(events[0].byWeekdays).toEqual([0, 2]);
    });

    test('normalizes hex color to lowercase when parsing note blocks', () => {
        const body = [
            '```mycalendar-event',
            'title: Colorful',
            'start: 2025-01-15 09:00:00',
            'color: #AABBCC',
            '',
            'uid: u-color',
            '```',
        ].join('\n');

        const events = parseEventsFromBody('note-1', 'Fallback', body);
        expect(events).toHaveLength(1);
        expect(events[0].color).toBe('#aabbcc');
    });

    test('parseRepeatUntilToUTC treats date-only values as inclusive end of day', () => {
        const utc = parseRepeatUntilToUTC('2026-12-31', 'America/Toronto');
        expect(utc).not.toBeNull();
        expect(new Date(utc as number).toISOString()).toBe('2027-01-01T04:59:59.000Z');
    });

    test('date-only all-day event is interpreted as midnight in its timezone', () => {
        const body = [
            '```mycalendar-event',
            'title: All day',
            'start: 2025-01-01',
            'end: 2025-01-02',
            'tz: America/Toronto',
            'all_day: true',
            '',
            'uid: u-all-day',
            '```',
        ].join('\n');

        const events = parseEventsFromBody('note-1', 'Fallback', body);

        expect(events).toHaveLength(1);
        expect(events[0].allDay).toBe(true);
        expect(new Date(events[0].startUtc).toISOString()).toBe('2025-01-01T05:00:00.000Z');
        expect(new Date(events[0].endUtc as number).toISOString()).toBe('2025-01-02T04:59:59.999Z');
    });

    test('preserves imported UID, recurrence identity, and all valid VALARMs', () => {
        const body = [
            '```mycalendar-event',
            'title: Exception',
            'start: 2025-01-22 10:00:00',
            'tz: America/Toronto',
            'valarm: {"trigger":"-PT15M","action":"DISPLAY"}',
            'valarm: invalid-json',
            'valarm: {"trigger":"-PT1H","related":"START"}',
            'uid: source-series',
            'recurrence_id: America/Toronto:20250122T090000',
            '```',
        ].join('\n');

        const [event] = parseEventsFromBody('note-1', 'Fallback', body);

        expect(event.uid).toBe('source-series');
        expect(event.recurrenceId).toBe('America/Toronto:20250122T090000');
        expect(event.valarms).toEqual([
            {trigger: '-PT15M', action: 'DISPLAY'},
            {trigger: '-PT1H', related: 'START'},
        ]);
        expect(event.hasAlarms).toBe(true);
    });
});
