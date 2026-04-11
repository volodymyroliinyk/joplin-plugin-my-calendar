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
});
