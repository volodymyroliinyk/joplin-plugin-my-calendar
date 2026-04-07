import {parseEventsFromBody} from '../../src/main/parsers/eventParser';

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
});
