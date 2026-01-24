// tests/parsers/eventParser.test.ts
// src/main/parsers/eventParser.ts
//
// npx jest tests/parsers/eventParser.test.ts --runInBand --no-cache;
//
// Notes for deterministic tests:
// - Some parsing paths (no tz + no explicit offset) depend on the machine timezone.
//   For stable results, run Jest with TZ=UTC, e.g.:
//     "test": "TZ=UTC jest"
//
// These tests focus on parseEventsFromBody() behavior, covering:
// - block extraction
// - key parsing & fallbacks
// - datetime parsing (offset, tz conversion, invalid inputs)
// - all_day behavior (inclusive end, default end, safety)
// - repeat rules parsing
//

import {parseEventsFromBody} from '../../src/main/parsers/eventParser';

const block = (lines: string[]) =>
    [
        '```mycalendar-event',
        ...lines,
        '```',
    ].join('\n');

describe('eventParser.parseEventsFromBody', () => {
    const noteId = 'note-123';
    const fallbackTitle = 'Fallback title';

    test('returns empty array when body has no event blocks', () => {
        const body = `Hello\nNo events here\n`;
        expect(parseEventsFromBody(noteId, fallbackTitle, body)).toEqual([]);
    });

    test('parses a minimal block (start only) and uses title fallback', () => {
        const body = block([
            'start: 2025-01-15T10:00:00Z',
        ]);

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(1);

        const ev = events[0];
        expect(ev.id).toBe(noteId);
        expect(ev.title).toBe(fallbackTitle);
        expect(ev.startText).toBe('2025-01-15T10:00:00Z');
        expect(ev.startUtc).toBe(new Date('2025-01-15T10:00:00Z').getTime());
        expect(ev.endUtc).toBeUndefined();
        expect(ev.allDay).toBeUndefined();
    });

    test('parses multiple blocks from a single body', () => {
        const body = [
            'Intro text',
            block(['title: A', 'start: 2025-01-15T10:00:00Z']),
            'Between',
            block(['title: B', 'start: 2025-01-15T11:00:00Z']),
            'Outro',
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(2);
        expect(events[0].title).toBe('A');
        expect(events[1].title).toBe('B');
    });

    test('ignores non key:value lines inside the block', () => {
        const body = block([
            'title: Party',
            'this is not a key/value line',
            'start: 2025-01-15T10:00:00Z',
            '# also not a key/value',
            'location: Home',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.title).toBe('Party');
        expect(ev.location).toBe('Home');
        expect(ev.description).toBeUndefined();
    });

    test('parses description/location/color and overrides fallback title', () => {
        const body = block([
            'title: My Event',
            'description: some text',
            'location: Montreal',
            'color: #3366ff',
            'start: 2025-01-15T10:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.title).toBe('My Event');
        expect(ev.description).toBe('some text');
        expect(ev.location).toBe('Montreal');
        expect(ev.color).toBe('#3366ff');
    });

    test('skips an event when start is missing', () => {
        const body = block([
            'title: Missing start',
        ]);
        expect(parseEventsFromBody(noteId, fallbackTitle, body)).toEqual([]);
    });

    test('skips an event when start is invalid', () => {
        const body = block([
            'title: Bad start',
            'start: not-a-date',
        ]);
        expect(parseEventsFromBody(noteId, fallbackTitle, body)).toEqual([]);
    });

    test('parses start/end with explicit offsets (tz irrelevant)', () => {
        const body = block([
            'title: Offset',
            'tz: Not/A_Real_Zone',
            'start: 2025-01-15 10:00:00-05:00',
            'end: 2025-01-15T12:00:00-05:00',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.startUtc).toBe(new Date('2025-01-15T10:00:00-05:00').getTime());
        expect(ev.endUtc).toBe(new Date('2025-01-15T12:00:00-05:00').getTime());
        expect(ev.tz).toBe('Not/A_Real_Zone');
    });

    test('parses wall-clock time using tz (winter date for stable -05:00 in America/Toronto)', () => {
        const body = block([
            'title: TZ convert',
            'tz: America/Toronto',
            'start: 2025-01-15 10:00:00',
            'end: 2025-01-15 11:30:00',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);

        // 10:00 in America/Toronto on Jan 15, 2025 => 15:00 UTC
        const expectedStart = Date.UTC(2025, 0, 15, 15, 0, 0);
        const expectedEnd = Date.UTC(2025, 0, 15, 16, 30, 0);

        expect(ev.startUtc).toBe(expectedStart);
        expect(ev.endUtc).toBe(expectedEnd);
    });

    test('skips event when tz is provided but invalid and there is no explicit offset', () => {
        const body = block([
            'title: Invalid tz',
            'tz: Invalid/Zone',
            'start: 2025-01-15 10:00:00',
        ]);

        expect(parseEventsFromBody(noteId, fallbackTitle, body)).toEqual([]);
    });

    test('end is optional; invalid end is ignored for non-all-day events', () => {
        const body = block([
            'title: Bad end',
            'start: 2025-01-15T10:00:00Z',
            'end: not-a-date',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.startUtc).toBe(new Date('2025-01-15T10:00:00Z').getTime());
        expect(ev.endUtc).toBeUndefined();
    });

    test('all_day=true makes end inclusive by subtracting 1ms (ICS exclusive end)', () => {
        const body = block([
            'title: All day',
            'all_day: true',
            'start: 2025-01-01T00:00:00Z',
            'end: 2025-01-02T00:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        const start = new Date('2025-01-01T00:00:00Z').getTime();
        const endExclusive = new Date('2025-01-02T00:00:00Z').getTime();

        expect(ev.allDay).toBe(true);
        expect(ev.startUtc).toBe(start);
        expect(ev.endUtc).toBe(endExclusive - 1);
    });

    test('all_day=true without end => defaults to start + 24h - 1ms', () => {
        const body = block([
            'title: All day no end',
            'all_day: yes',
            'start: 2025-01-01T00:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        const start = new Date('2025-01-01T00:00:00Z').getTime();
        const dayMs = 24 * 60 * 60 * 1000;

        expect(ev.allDay).toBe(true);
        expect(ev.endUtc).toBe(start + dayMs - 1);
    });

    test('all_day=true with end <= start => safety: end becomes start + 24h - 1ms', () => {
        const body = block([
            'title: All day safety',
            'all_day: 1',
            'start: 2025-01-01T00:00:00Z',
            'end: 2025-01-01T00:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        const start = new Date('2025-01-01T00:00:00Z').getTime();
        const dayMs = 24 * 60 * 60 * 1000;

        expect(ev.allDay).toBe(true);
        expect(ev.endUtc).toBe(start + dayMs - 1);
    });

    test('all_day=false does not adjust end', () => {
        const body = block([
            'title: Not all day',
            'all_day: false',
            'start: 2025-01-01T00:00:00Z',
            'end: 2025-01-02T00:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.allDay).toBe(false);
        expect(ev.endUtc).toBe(new Date('2025-01-02T00:00:00Z').getTime());
    });

    test('parses repeat rules: repeat, repeat_interval, repeat_until, byweekday, bymonthday', () => {
        const body = block([
            'title: Repeating',
            'tz: UTC',
            'start: 2025-01-15 10:00:00',
            'repeat: weekly',
            'repeat_interval: 2',
            'repeat_until: 2025-02-01 00:00:00',
            'byweekday: MO, WE, xx',
            'bymonthday: 31',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);

        // start is in UTC wall-clock => same as UTC instant
        expect(ev.startUtc).toBe(Date.UTC(2025, 0, 15, 10, 0, 0));
        expect(ev.repeat).toBe('weekly');
        expect(ev.repeatInterval).toBe(2);
        expect(ev.repeatUntilUtc).toBe(Date.UTC(2025, 1, 1, 0, 0, 0));
        expect(ev.byWeekdays).toEqual([0, 2]); // MO=0, WE=2
        expect(ev.byMonthDay).toBe(31);
    });

    test('invalid repeat value becomes "none"', () => {
        const body = block([
            'title: Repeat invalid',
            'start: 2025-01-15T10:00:00Z',
            'repeat: hourly',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.repeat).toBe('none');
    });

    test('repeat_interval must be >= 1; invalid values keep default = 1', () => {
        const body = block([
            'title: Repeat interval invalid',
            'start: 2025-01-15T10:00:00Z',
            'repeat: daily',
            'repeat_interval: 0',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.repeat).toBe('daily');
        expect(ev.repeatInterval).toBe(1);
    });

    test('all_day is NOT sticky across blocks within the same parse call', () => {
        const body = [
            block([
                'title: First',
                'all_day: true',
                'start: 2025-01-01T00:00:00Z',
            ]),
            block([
                'title: Second',
                // no all_day line here
                'start: 2025-01-02T00:00:00Z',
            ]),
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(2);

        expect(events[0].allDay).toBe(true);
        expect(events[1].allDay).toBeUndefined(); // per-block behavior
    });


    test('timezone key alias: both "tz" are accepted (case-insensitive keys)', () => {
        const body = [
            block([
                'TITLE: A',
                'TZ: UTC',
                'START: 2025-01-15 10:00:00',
            ]),
            block([
                'title: B',
                'tz: UTC',
                'start: 2025-01-15 11:00:00',
            ]),
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(2);
        expect(events[0].startUtc).toBe(Date.UTC(2025, 0, 15, 10, 0, 0));
        expect(events[1].startUtc).toBe(Date.UTC(2025, 0, 15, 11, 0, 0));


    });

    test('parses blocks with CRLF line endings and indentation around fences', () => {
        const body = [
            'Intro',
            '   ```mycalendar-event\r\n',
            '   title: Indented\r\n',
            '   start: 2025-01-15T10:00:00Z\r\n',
            '   ```\r\n',
            'Outro',
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(1);
        expect(events[0].title).toBe('Indented');
        expect(events[0].startUtc).toBe(new Date('2025-01-15T10:00:00Z').getTime());
    });

    test('does not parse an unterminated block (missing closing fence)', () => {
        const body = [
            '```mycalendar-event',
            'title: Unterminated',
            'start: 2025-01-15T10:00:00Z',
            // no closing ```
        ].join('\n');

        expect(parseEventsFromBody(noteId, fallbackTitle, body)).toEqual([]);
    });

    test('title with only whitespace falls back to titleFallback', () => {
        const body = block([
            'title:     ',
            'start: 2025-01-15T10:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.title).toBe(fallbackTitle);
    });

    test('all_day parsing accepts yes/no (case-insensitive)', () => {
        const body = [
            block([
                'title: Yes',
                'all_day: YES',
                'start: 2025-01-01T00:00:00Z',
            ]),
            block([
                'title: No',
                'all_day: no',
                'start: 2025-01-01T00:00:00Z',
            ]),
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(2);
        expect(events[0].allDay).toBe(true);
        expect(events[1].allDay).toBe(false);
    });

    test('byweekday ignores invalid tokens, preserves duplicates, and is case/space tolerant', () => {
        const body = block([
            'title: Weekdays',
            'start: 2025-01-15T10:00:00Z',
            'byweekday: mo, WE,  mo , xx, we',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        // MO=0, WE=2; duplicates preserved by current implementation
        expect(ev.byWeekdays).toEqual([0, 2, 0, 2]);
    });

    test('byweekday with no valid weekdays results in undefined', () => {
        const body = block([
            'title: Weekdays none',
            'start: 2025-01-15T10:00:00Z',
            'byweekday: xx, yy',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.byWeekdays).toBeUndefined();
    });

    test('bymonthday invalid values are ignored', () => {
        const body = [
            block([
                'title: MD 0',
                'start: 2025-01-15T10:00:00Z',
                'bymonthday: 0',
            ]),
            block([
                'title: MD 32',
                'start: 2025-01-15T10:00:00Z',
                'bymonthday: 32',
            ]),
        ].join('\n');

        const events = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(events).toHaveLength(2);
        expect(events[0].byMonthDay).toBeUndefined();
        expect(events[1].byMonthDay).toBeUndefined();
    });

    test('tz line with whitespace becomes empty string and does not break parsing when start has explicit offset', () => {
        const body = block([
            'title: Empty tz',
            'tz:    ',
            'start: 2025-01-15T10:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.tz).toBeUndefined(); // current behavior: stored as empty string
        expect(ev.startUtc).toBe(new Date('2025-01-15T10:00:00Z').getTime());
    });

    test('parses explicit offsets without colon (+0300) by canonicalizing to +03:00', () => {
        const body = block([
            'title: Offset no colon',
            'start: 2025-01-15T10:00:00+0300',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.startUtc).toBe(new Date('2025-01-15T10:00:00+03:00').getTime());
    });

    test('parses wall-clock time without seconds when tz is provided', () => {
        const body = block([
            'title: No seconds',
            'tz: UTC',
            'start: 2025-01-15 10:00',
            'end: 2025-01-15 10:05',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(ev.startUtc).toBe(Date.UTC(2025, 0, 15, 10, 0, 0));
        expect(ev.endUtc).toBe(Date.UTC(2025, 0, 15, 10, 5, 0));
    });

    test('repeat_until parsing is order-sensitive: if repeat_until appears before tz, it is parsed without tz', () => {
        // This demonstrates current behavior: repeat_until is parsed at the moment it is encountered.
        // For deterministic results, run Jest with TZ=UTC.
        const body = block([
            'title: Order',
            'repeat: weekly',
            'repeat_until: 2025-02-01 00:00:00',
            'tz: America/Toronto',
            'start: 2025-01-15T10:00:00Z',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);

        // Parsed as device-local time because tz was not known yet at repeat_until line.
        expect(ev.repeatUntilUtc).toBe(new Date('2025-02-01T00:00:00').getTime());
    });

    test('all_day parsing exhaustive: true, false, 1, 0, yes, no', () => {
        const body = [
            block(['title: T1', 'start: 2025-01-01T00:00:00Z', 'all_day: true']),
            block(['title: T2', 'start: 2025-01-01T00:00:00Z', 'all_day: false']),
            block(['title: T3', 'start: 2025-01-01T00:00:00Z', 'all_day: 1']),
            block(['title: T4', 'start: 2025-01-01T00:00:00Z', 'all_day: 0']),
            block(['title: T5', 'start: 2025-01-01T00:00:00Z', 'all_day: yes']),
            block(['title: T6', 'start: 2025-01-01T00:00:00Z', 'all_day: no']),
        ].join('\n');

        const evs = parseEventsFromBody(noteId, fallbackTitle, body);
        expect(evs[0].allDay).toBe(true);
        expect(evs[1].allDay).toBe(false);
        expect(evs[2].allDay).toBe(true);
        expect(evs[3].allDay).toBe(false);
        expect(evs[4].allDay).toBe(true);
        expect(evs[5].allDay).toBe(false);
    });

    test('byweekday parsing extreme cases: spaces, empty tokens, invalid days', () => {
        const body = block([
            'title: W',
            'start: 2025-01-01T00:00:00Z',
            'byweekday:  , MO, , tu , FOO, sa , ',
        ]);

        const [ev] = parseEventsFromBody(noteId, fallbackTitle, body);
        // MO=0, TU=1, SA=5
        expect(ev.byWeekdays).toEqual([0, 1, 5]);
    });
});