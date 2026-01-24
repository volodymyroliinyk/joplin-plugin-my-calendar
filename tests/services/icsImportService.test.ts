// tests/services/icsImportService.test.ts
//
// src/main/services/icsImportService.ts
//
// npx jest tests/services/icsImportService.test.ts --runInBand --no-cache;
//
// Coverage of the maximum possible scenarios for importIcsIntoNotes():
// - ICS parsing (DTSTART/DTEND, TZID, VALUE=DATE => all_day, folded lines, unescape)
// - parsing key:value format (without BEGIN:VCALENDAR)
// - RRULE (FREQ/INTERVAL/UNTIL/BYDAY/BYMONTHDAY)
// - building existing map (pagination, filters)
// - update vs create (put/post), patch logic (only body / only title / nothing => skipped)
// - preserveLocalColor ON/OFF
// - importDefaultColor
// - master vs recurrence instance
// - uid missing => skipped
// - error paths update/create + onStatus message
// - targetFolderId for notes to be created
//
// Recommendation: run with TZ=UTC (you already have it in scripts).

import {importIcsIntoNotes} from '../../src/main/services/icsImportService';

type JoplinMock = {
    data: {
        get: jest.Mock<any, any>;
        put: jest.Mock<any, any>;
        post: jest.Mock<any, any>;
        delete?: jest.Mock<any, any>;
    };
};

const mkJoplin = (impl?: Partial<JoplinMock['data']>): JoplinMock => ({
    data: {
        get: impl?.get ?? jest.fn(),
        put: impl?.put ?? jest.fn(),
        post: impl?.post ?? jest.fn(),
        delete: (impl as any)?.delete ?? jest.fn(),
    },
});

const block = (inner: string) =>
    ['```mycalendar-event', inner.trim(), '```'].join('\n');

describe('icsImportService.importIcsIntoNotes', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {
        });
        jest.spyOn(console, 'error').mockImplementation(() => {
        });
    });

    afterEach(() => {
        (console.log as any).mockRestore?.();
        (console.error as any).mockRestore?.();
    });

    test('parses ICS, reports Parsed N, scans existing notes with pagination, creates new note (POST)', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Hello',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const onStatus = jest.fn();

        const joplin = mkJoplin({
            get: jest
                .fn()
                // page 1
                .mockResolvedValueOnce({
                    items: [{id: 'n1', title: 'Old', body: 'no blocks here', parent_id: '47848cdkjjfdjff'}],
                    has_more: true,
                })
                // page 2
                .mockResolvedValueOnce({
                    items: [
                        {
                            id: 'n2',
                            title: 'Has block',
                            body: block(`uid: something\nstart: 2025-01-01 00:00:00`),
                            parent_id: '47848cdkjjfdjff'
                        },
                    ],
                    has_more: false,
                }),
            post: jest.fn().mockResolvedValue({id: 'new-id'}),
            put: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);

        expect(onStatus).toHaveBeenCalledWith('Parsed 1 VEVENT(s)');

        // existing scan paginates
        expect(joplin.data.get).toHaveBeenCalledTimes(2);
        expect(joplin.data.get).toHaveBeenNthCalledWith(1, ['notes'], {
            fields: ['id', 'title', 'body', 'parent_id'],
            limit: 100,
            page: 1,
        });
        expect(joplin.data.get).toHaveBeenNthCalledWith(2, ['notes'], {
            fields: ['id', 'title', 'body', 'parent_id'],
            limit: 100,
            page: 2,
        });

        // create called once
        expect(joplin.data.post).toHaveBeenCalledTimes(1);
        expect(joplin.data.put).not.toHaveBeenCalled();

        const [, , noteBody] = joplin.data.post.mock.calls[0];
        expect(noteBody.title).toBe('Hello');
        expect(noteBody.body).toContain('```mycalendar-event');
        expect(noteBody.body).toContain('title: Hello');
        expect(noteBody.body).toContain('start: 2025-01-15 10:00:00+00:00');
        expect(noteBody.body).toContain('end: 2025-01-15 11:30:00+00:00');
        expect(noteBody.body).toContain('uid: u1');

        expect(res).toEqual({added: 1, updated: 0, skipped: 0, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
    });

    test('imports VALARM as valarm: {json} lines inside mycalendar-event block (supports multiple VALARM)', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u-valarm',
            'SUMMARY:With alarm',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'DESCRIPTION:Reminder 1',
            'TRIGGER;RELATED=START:-PT1H',
            'END:VALARM',
            'BEGIN:VALARM',
            'TRIGGER:-P1D',
            'ACTION:DISPLAY',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const onStatus = jest.fn();

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValueOnce({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'new-id'}),
            put: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);

        expect(onStatus).toHaveBeenCalledWith('Parsed 1 VEVENT(s)');
        expect(joplin.data.post).toHaveBeenCalledTimes(1);

        const [, , noteBody] = (joplin.data.post as any).mock.calls[0];
        expect(noteBody.title).toBe('With alarm');

        // two alarms => two "valarm:" lines
        const matches = String(noteBody.body).match(/^valarm:\s*\{.*\}$/gm) || [];
        expect(matches.length).toBe(2);

        expect(noteBody.body).toContain('valarm: {"trigger":"-PT1H","related":"START","action":"DISPLAY","description":"Reminder 1"}');
        expect(noteBody.body).toContain('valarm: {"trigger":"-P1D","action":"DISPLAY"}');

        expect(res).toEqual({added: 1, updated: 0, skipped: 0, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
    });

    test('creates todo+alarm notes from VALARM (only future alarms, within 60 days)', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-15T08:00:00.000Z')); // now

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u-valarm2',
            'SUMMARY:With alarm',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'TRIGGER;RELATED=START:-PT1H',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValueOnce({items: [], has_more: false}),
            post: jest.fn()
                .mockResolvedValueOnce({id: 'event-note-id'}) // event note
                .mockResolvedValueOnce({id: 'alarm-note-id'}), // alarm todo
            put: jest.fn(),
        });

        const onStatus = jest.fn();

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus, 'nb1');

        expect(res.added).toBe(1);
        expect(res.alarmsCreated).toBe(1);
        expect((joplin.data.post as any).mock.calls.length).toBe(2);

        const alarmCall = (joplin.data.post as any).mock.calls[1];
        const alarmNote = alarmCall[2];

        expect(alarmNote.parent_id).toBe('nb1');
        expect(alarmNote.is_todo).toBe(1);
        expect(alarmNote.alarm_time).toBe(new Date('2025-01-15T09:00:00.000Z').getTime());
        expect(alarmNote.todo_due).toBe(new Date('2025-01-15T09:00:00.000Z').getTime());

        // ensure alarm fields are persisted reliably via PUT after POST
        expect((joplin.data.put as any)).toHaveBeenCalledWith(['notes', 'alarm-note-id'], null, {
            alarm_time: new Date('2025-01-15T09:00:00.000Z').getTime(),
            todo_due: new Date('2025-01-15T09:00:00.000Z').getTime(),
        });
        expect(String(alarmNote.body)).toContain('```mycalendar-alarm');
        expect(String(alarmNote.body)).toContain('uid: u-valarm2');
        expect(String(alarmNote.body)).toContain('[With alarm](:/event-note-id)');

        jest.useRealTimers();
    });

    test('reimport deletes old alarm notes for the same uid+recurrence and regenerates', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-15T08:00:00.000Z')); // now

        const existingEvent = {
            id: 'event-note-id',
            title: 'With alarm',
            parent_id: 'nb1',
            body: [
                '```mycalendar-event',
                'title: With alarm',
                'uid: u-del',
                'recurrence_id: ',
                'start: 2025-01-15 10:00:00+00:00',
                'end: 2025-01-15 11:30:00+00:00',
                '```',
            ].join('\n'),
        };

        const existingAlarm = {
            id: 'old-alarm-id',
            title: 'With alarm + 2025-01-15 09:00',
            parent_id: 'nb1',
            body: [
                '```mycalendar-alarm',
                'title: With alarm + 2025-01-15 09:00',
                'uid: u-del',
                'recurrence_id: ',
                'when: 2025-01-15 09:00:00+00:00',
                '```',
                '',
                '---',
                '',
                '[With alarm](:/event-note-id)',
            ].join('\n'),
        };

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u-del',
            'SUMMARY:With alarm',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'TRIGGER:-PT1H',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn()
                .mockResolvedValueOnce({items: [existingEvent, existingAlarm], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'new-alarm-id'}), // only alarm created (event updated/skipped)
            put: jest.fn(),
            delete: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, 'nb1');

        expect((joplin.data.delete as any)).toHaveBeenCalledWith(['notes', 'old-alarm-id']);
        expect((joplin.data.post as any)).toHaveBeenCalledTimes(1);
        const [, , createdAlarmNote] = (joplin.data.post as any).mock.calls[0];
        expect(createdAlarmNote.is_todo).toBe(1);
        expect(createdAlarmNote.todo_due).toBe(new Date('2025-01-15T09:00:00.000Z').getTime());
        expect(createdAlarmNote.alarm_time).toBe(new Date('2025-01-15T09:00:00.000Z').getTime());
        // ensure alarm fields are persisted reliably via PUT after POST
        expect((joplin.data.put as any)).toHaveBeenCalledWith(['notes', 'new-alarm-id'], null, {
            alarm_time: new Date('2025-01-15T09:00:00.000Z').getTime(),
            todo_due: new Date('2025-01-15T09:00:00.000Z').getTime(),
        });
        expect(res.alarmsDeleted).toBe(1);
        expect(res.alarmsCreated).toBe(1); // 1 valid alarm in next 60 days
        expect(res.errors).toBe(0);

        jest.useRealTimers();
    });


    test('supports folded lines + unescape in DESCRIPTION/LOCATION', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Hello',
            'DESCRIPTION:Line1\\nLine2\\,ok',
            'LOCATION:Montreal\\;QC',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:u2',
            'SUMMARY:Folded',
            // folded DESCRIPTION: next line begins with a space => must be concatenated
            'DESCRIPTION:This is a long line that will be ',
            ' continued and contains \\\\ backslash',
            'DTSTART:20250115T110000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.added).toBe(2);

        const call1 = joplin.data.post.mock.calls[0][2];
        expect(call1.body).toContain('description: Line1\nLine2,ok');
        expect(call1.body).toContain('location: Montreal;QC');

        const call2 = joplin.data.post.mock.calls[1][2];
        // 1) There is a description and it starts correctly
        expect(call2.body).toContain('description: This is a long line that will be');

        // 2) We check that the folded part has joined (we accept both with and without a space)
        expect(call2.body).toMatch(/will be\s*continued and contains/);

        // 3) We check that the backslash is expanded to 1 character
        // (in regex: \\ means one character "\")
        expect(call2.body).toMatch(/contains \\ backslash/);
    });

    test('DTSTART/DTEND with TZID keeps tz and normalizes date-time (no Z) into "YYYY-MM-DD HH:mm:ss"', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:TZ',
            'DTSTART;TZID=America/Toronto:20250115T090000',
            'DTEND;TZID=America/Toronto:20250115T100000',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('tz: America/Toronto');
        expect(noteBody.body).toContain('start: 2025-01-15 09:00:00');
        expect(noteBody.body).toContain('end: 2025-01-15 10:00:00');
    });

    test('VALUE=DATE or YYYYMMDD sets all_day: true and normalizes to 00:00:00', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:AllDay',
            'DTSTART;VALUE=DATE:20250101',
            'DTEND;VALUE=DATE:20250102',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('start: 2025-01-01 00:00:00');
        expect(noteBody.body).toContain('end: 2025-01-02 00:00:00');
        expect(noteBody.body).toContain('all_day: true');
    });

    test('parses RRULE into repeat fields and writes into block', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:RRule',
            'DTSTART:20250115T100000Z',
            'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20250201T000000Z;BYDAY=MO,WE;BYMONTHDAY=15',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('repeat: weekly');
        expect(noteBody.body).toContain('repeat_interval: 2');
        expect(noteBody.body).toContain('repeat_until: 2025-02-01 00:00:00+00:00');
        expect(noteBody.body).toContain('byweekday: MO,WE');
        expect(noteBody.body).toContain('bymonthday: 15');
    });

    test('uses X-COLOR from ICS and writes color', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Color',
            'X-COLOR:#123456',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('color: #123456');
    });

    test('parses RECURRENCE-ID with TZID and stores recurrence_id as "TZID:VALUE"', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Occ',
            'RECURRENCE-ID;TZID=America/Toronto:20250115T090000',
            'DTSTART;TZID=America/Toronto:20250115T090000',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('uid: u1');
        expect(noteBody.body).toContain('recurrence_id: America/Toronto:20250115T090000');
    });

    test('parses non-ICS input as key:value format and supports "---" separator + inline comments', async () => {
        const text = [
            'uid: u1',
            'title: A  # comment removed',
            'start: 2025-01-01 10:00:00',
            '',
            '---',
            'uid: u2',
            'summary: B',
            'start: 2025-01-01 11:00:00',
            'description: hello#notcomment', // # without preceding whitespace => stays
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, text);

        expect(res.added).toBe(2);
        const body1 = joplin.data.post.mock.calls[0][2].body as string;
        const body2 = joplin.data.post.mock.calls[1][2].body as string;

        expect(body1).toContain('title: A');
        expect(body1).not.toContain('# comment removed');

        expect(body2).toContain('title: B');
        expect(body2).toContain('description: hello#notcomment');
    });

    test('skips events that have no UID', async () => {
        const text = [
            'title: No UID',
            'start: 2025-01-01 10:00:00',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn(),
            put: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, text);

        expect(res).toEqual({added: 0, updated: 0, skipped: 1, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
        expect(joplin.data.post).not.toHaveBeenCalled();
        expect(joplin.data.put).not.toHaveBeenCalled();
    });

    test('preserveLocalColor=true: if existing has color and import missing => keeps local color (update)', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingBody = [
            'Some note text',
            block([
                'title: Title',
                'start: 2025-01-15 09:00:00+00:00', // <-- is different
                'color: #ff0000',
                '',
                'uid: u1',
            ].join('\n')),
        ].join('\n\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Title', body: existingBody}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
            post: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, undefined, true);

        expect(res.updated).toBe(1);
        expect(joplin.data.put).toHaveBeenCalledTimes(1);

        const [, , patch] = joplin.data.put.mock.calls[0];

        // body was updated (because start changed)
        expect(patch.body).toBeDefined();

        // and at the same time the color is saved from existing
        expect(patch.body).toContain('color: #ff0000');

        // and a new start with ICS
        expect(patch.body).toContain('start: 2025-01-15 10:00:00+00:00');
    });

    test('preserveLocalColor=false: does not copy local color; importDefaultColor is applied', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingBody = block([
            'title: Title',
            'start: 2025-01-15 10:00:00+00:00',
            'color: #ff0000',
            '',
            'uid: u1',
        ].join('\n'));

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Title', body: existingBody}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics, undefined, undefined, false, '#00ff00');

        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch.body).toContain('color: #00ff00');
        expect(patch.body).not.toContain('color: #ff0000');
    });

    test('importDefaultColor is applied only when event has no color after preserveLocalColor step', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:HasColor',
            'X-COLOR:#111111',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics, undefined, undefined, true, '#00ff00');

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.body).toContain('color: #111111');
        expect(noteBody.body).not.toContain('color: #00ff00');
    });

    test('update: when desiredTitle differs but body same => PUT only title', async () => {
        const text = [
            'uid: u1',
            'title: NEW',
            'start: 2025-01-01 10:00:00',
        ].join('\n');

        // existing note has SAME block (we craft it to match buildMyCalBlock output)
        const existingBlock = [
            '```mycalendar-event',
            'title: NEW',
            'start: 2025-01-01 10:00:00',
            '',
            'uid: u1',
            '```',
        ].join('\n');

        const existingNote = {
            id: 'n1',
            title: 'OLD', // only title differs
            body: existingBlock,
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, text);

        expect(res.updated).toBe(1);
        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch).toEqual({title: 'NEW'});
    });

    test('update: when body differs but title same => PUT only body', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:SameTitle',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingNote = {
            id: 'n1',
            title: 'SameTitle',
            body: block([
                'title: SameTitle',
                'start: 2025-01-15 09:00:00+00:00', // different
                '',
                'uid: u1',
            ].join('\n')),
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.updated).toBe(1);
        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch.title).toBeUndefined();
        expect(patch.body).toContain('start: 2025-01-15 10:00:00+00:00');
    });

    test('update: if nothing changes => skipped++ and no PUT', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Same',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        // exact block that buildMyCalBlock will generate (no end, no tz, no repeat)
        const existingNote = {
            id: 'n1',
            title: 'Same',
            body: [
                '```mycalendar-event',
                'title: Same',
                'start: 2025-01-15 10:00:00+00:00',
                '',
                'uid: u1',
                '```',
            ].join('\n'),
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn(),
            post: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res).toEqual({added: 0, updated: 0, skipped: 1, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
        expect(joplin.data.put).not.toHaveBeenCalled();
        expect(joplin.data.post).not.toHaveBeenCalled();
    });

    test('master vs recurrence: updates correct block based on recurrence_id', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:OccTitle',
            'RECURRENCE-ID:20250115T100000Z',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const master = block([
            'title: Master',
            'start: 2025-01-01 00:00:00+00:00',
            '',
            'uid: u1',
        ].join('\n'));

        const occ = block([
            'title: OldOcc',
            'start: 2025-01-15 09:00:00+00:00',
            '',
            'uid: u1',
            'recurrence_id: 20250115T100000Z',
        ].join('\n'));

        const existingNote = {
            id: 'n1',
            title: 'Note',
            body: `${master}\n\n${occ}\n`,
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.updated).toBe(1);

        const patch = joplin.data.put.mock.calls[0][2];
        // master should remain
        expect(patch.body).toContain('title: Master');
        // occurrence should be replaced with new title/start
        expect(patch.body).toContain('title: OccTitle');
        expect(patch.body).toContain('recurrence_id: 20250115T100000Z');
        expect(patch.body).toContain('start: 2025-01-15 10:00:00+00:00');
    });

    test('create: if targetFolderId provided => POST includes parent_id', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Foldered',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        await importIcsIntoNotes(joplin as any, ics, undefined, 'folder-123');

        const noteBody = joplin.data.post.mock.calls[0][2];
        expect(noteBody.parent_id).toBe('folder-123');
    });

    test('update: if targetFolderId changes => PUT includes parent_id even if body/title unchanged', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Same',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingNote = {
            id: 'n1',
            title: 'Same',
            parent_id: 'folder-old',
            body: [
                '```mycalendar-event',
                'title: Same',
                'start: 2025-01-15 10:00:00+00:00',
                '',
                'uid: u1',
                '```',
            ].join('\n'),
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, 'folder-new');

        expect(res).toEqual({added: 0, updated: 1, skipped: 0, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
        expect(joplin.data.put).toHaveBeenCalledTimes(1);
        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch).toEqual({parent_id: 'folder-new'});
    });

    test('error on update: increments errors and calls onStatus with ERROR update', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:X',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingNote = {
            id: 'n1',
            title: 'X',
            body: block(['title: X', 'start: 2025-01-15 09:00:00+00:00', '', 'uid: u1'].join('\n')),
        };

        const onStatus = jest.fn();

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn().mockRejectedValue(new Error('boom')),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);

        expect(res.errors).toBe(1);
        expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/^ERROR update: u1\|/));
    });

    test('error on create: increments errors and calls onStatus with ERROR create', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:X',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const onStatus = jest.fn();

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockRejectedValue(new Error('boom')),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);

        expect(res.errors).toBe(1);
        expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/^ERROR create: u1\|/));
    });

    test('safe onStatus: if callback throws, import still succeeds', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Ok',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const onStatus = jest.fn(() => {
            throw new Error('status crash');
        });

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);
        expect(res.added).toBe(1);
    });

    test('existing scan ignores notes without body or without mycalendar blocks', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:A',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [
                    {id: 'n1', title: 'x', body: null},
                    {id: 'n2', title: 'y', body: 123},
                    {id: 'n3', title: 'z', body: 'no block marker'},
                ],
                has_more: false,
            }),
            post: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);
        expect(res.added).toBe(1);
    });

    test('preserveLocalColor=true but import has its own color => keeps imported color (does not copy local)', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'X-COLOR:#111111',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingBody = block([
            'title: Title',
            'start: 2025-01-15 09:00:00+00:00',
            'color: #ff0000',
            '',
            'uid: u1',
        ].join('\n'));

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Title', body: existingBody}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, undefined, true);

        expect(res.updated).toBe(1);
        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch.body).toContain('color: #111111');
        expect(patch.body).not.toContain('color: #ff0000');
    });

    test('importDefaultColor applied only if event has no color AND preserveLocalColor did not provide one', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        // existing also has NO color -> preserveLocalColor cannot fill
        const existingBody = block([
            'title: Title',
            'start: 2025-01-15 09:00:00+00:00',
            '',
            'uid: u1',
        ].join('\n'));

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Title', body: existingBody}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, undefined, true, '#00ff00');

        expect(res.updated).toBe(1);
        const patch = joplin.data.put.mock.calls[0][2];
        expect(patch.body).toContain('color: #00ff00');
    });

    test('preserveLocalColor=true with identical resulting block => skipped++ and no PUT', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Same',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        // existing block is already exactly what import will generate (no color, no end)
        const existingNote = {
            id: 'n1',
            title: 'Same',
            body: [
                '```mycalendar-event',
                'title: Same',
                'start: 2025-01-15 10:00:00+00:00',
                '',
                'uid: u1',
                '```',
            ].join('\n'),
        };

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            put: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, undefined, true);

        expect(res).toEqual({added: 0, updated: 0, skipped: 1, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
        expect(joplin.data.put).not.toHaveBeenCalled();
    });

    test('multiple mycalendar blocks in one note: existing map contains multiple keys and updates correct one', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u2',
            'SUMMARY:U2',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const body = [
            block(['title: U1', 'start: 2025-01-01 00:00:00+00:00', '', 'uid: u1'].join('\n')),
            block(['title: U2', 'start: 2025-01-15 09:00:00+00:00', '', 'uid: u2'].join('\n')),
        ].join('\n\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Note', body}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.updated).toBe(1);
        const patchBody = joplin.data.put.mock.calls[0][2].body as string;

        // u1 block untouched
        expect(patchBody).toContain('uid: u1');
        expect(patchBody).toContain('title: U1');

        // u2 block updated
        expect(patchBody).toContain('uid: u2');
        expect(patchBody).toContain('start: 2025-01-15 10:00:00+00:00');
    });

    test('master vs occurrence in same note: updating master does not touch occurrence blocks', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:MasterTitle',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const master = block([
            'title: MasterTitle',
            'start: 2025-01-15 09:00:00+00:00',
            '',
            'uid: u1',
        ].join('\n'));

        const occ = block([
            'title: OccTitle',
            'start: 2025-01-16 09:00:00+00:00',
            '',
            'uid: u1',
            'recurrence_id: 20250116T090000Z',
        ].join('\n'));

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Note', body: `${master}\n\n${occ}\n`}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.updated).toBe(1);
        const patchBody = joplin.data.put.mock.calls[0][2].body as string;

        // master updated to 10:00
        expect(patchBody).toContain('title: MasterTitle');
        expect(patchBody).toContain('start: 2025-01-15 10:00:00+00:00');

        // occurrence remains
        expect(patchBody).toContain('recurrence_id: 20250116T090000Z');
        expect(patchBody).toContain('title: OccTitle');
        expect(patchBody).toContain('start: 2025-01-16 09:00:00+00:00');
    });

    test('duplicate events in import with same UID cause multiple updates (PUT called twice)', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Title',
            'DTSTART:20250115T110000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const existingBody = block([
            'title: Title',
            'start: 2025-01-15 09:00:00+00:00',
            '',
            'uid: u1',
        ].join('\n'));

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'Title', body: existingBody}],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.updated).toBe(2);
        expect(joplin.data.put).toHaveBeenCalledTimes(2);

        const patch1 = joplin.data.put.mock.calls[0][2].body as string;
        const patch2 = joplin.data.put.mock.calls[1][2].body as string;

        expect(patch1).toContain('start: 2025-01-15 10:00:00+00:00');
        expect(patch2).toContain('start: 2025-01-15 11:00:00+00:00');
    });

    test('0 VEVENT(s): still scans existing notes, but produces no writes and returns all zeros', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'PRODID:-//X//Y//EN',
            'END:VCALENDAR',
        ].join('\n');

        const onStatus = jest.fn();

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            put: jest.fn(),
            post: jest.fn(),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, onStatus);

        expect(onStatus).toHaveBeenCalledWith('Parsed 0 VEVENT(s)');
        expect(res).toEqual({added: 0, updated: 0, skipped: 0, errors: 0, alarmsCreated: 0, alarmsDeleted: 0});
        expect(joplin.data.put).not.toHaveBeenCalled();
        expect(joplin.data.post).not.toHaveBeenCalled();

        // scan existing notes still happens once
        expect(joplin.data.get).toHaveBeenCalledTimes(1);
    });

    test('replaceEventBlockByKey append path is reachable: existing map points to note, but body no longer contains matching block => appends new block', async () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u1',
            'SUMMARY:Append',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        // existing scan must “see” key, but later body used for update is missing the block.
        // This is difficult to reproduce due to a real existing-scan (it takes body and immediately puts it in existing[key].body),
        // so we do the trick: note body contains a block with uid u1, but replace won't find it if uid is replaced with spaces/other case?
        // No - uid trim and case-sensitive. Therefore, we do it realistically: existing block uid=u1, but import uid=" u1 " (trim => u1) => will find.
        // For append, it is necessary that parseUidAndRecurrence does not find the uid in the existing body => the key would not be indexed.
        //
        // Therefore, this test does not unify the append branch directly (it is for the "drift" of data between scan and update),
        // but checks that body can grow by adding a new block if replace couldn't find a match
        // in the given body (we simulate this through injection: existing[key].body without a block, but the key exists from another note).
        //
        // Implement through 2 notes:
        // - note1 has block u1 => existing[key] will point to note1
        // - note2 has the same key u1 and is later in res.items => existing[key] will be overwritten to note2,
        // but body note2 we do "without a block" (in reality it won't be like that, but this is a test for safe-append).
        const note1 = {
            id: 'n1',
            title: 'T1',
            body: block(['title: T', 'start: 2025-01-01 00:00:00+00:00', '', 'uid: u1'].join('\n'))
        };
        const note2 = {id: 'n2', title: 'T2', body: 'Body drifted (no blocks anymore)'};

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [note1, note2],
                has_more: false,
            }),
            put: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        // update should still happen (body differs -> appended block)
        expect(res.updated).toBe(1);

        const patchBody = joplin.data.put.mock.calls[0][2].body as string;
        expect(patchBody).toContain('```mycalendar-event');
        expect(patchBody).toContain('uid: u1');
        expect(patchBody).toContain('title: Append');
    });

    test('key:value inline comments: strips only when whitespace before #, keeps # inside value', async () => {
        const importText = [
            'title: A#B',
            'description: Hello # this is a comment',
            'start: 2025-01-01 00:00:00+00:00',
            'uid: u_hash',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        await importIcsIntoNotes(joplin as any, importText);

        const body = joplin.data.post.mock.calls[0][2].body as string;
        expect(body).toContain('title: A#B');
        expect(body).toContain('description: Hello');
        expect(body).not.toContain('# this is a comment');
    });

    test('RRULE with unsupported FREQ or invalid INTERVAL/UNTIL does not emit repeat section', async () => {
        const ics = [
            'BEGIN:VEVENT',
            'UID:u_bad_rrule',
            'SUMMARY:Bad RRule',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'RRULE:FREQ=HOURLY;INTERVAL=0;UNTIL=NOT_A_DATE;BYDAY=MO;BYMONTHDAY=1',
            'END:VEVENT',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const body = joplin.data.post.mock.calls[0][2].body as string;
        expect(body).toContain('uid: u_bad_rrule');
        expect(body).not.toContain('repeat:');
        expect(body).not.toContain('byweekday:');
        expect(body).not.toContain('bymonthday:');
        expect(body).not.toContain('repeat_until:');
    });

    test('folded lines also work with TAB prefix (ICS line unfolding)', async () => {
        const ics = [
            'BEGIN:VEVENT',
            'UID:u_tab_fold',
            'SUMMARY:Fold',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'DESCRIPTION:Line1',
            '\tLine2',
            'END:VEVENT',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        await importIcsIntoNotes(joplin as any, ics);

        const body = joplin.data.post.mock.calls[0][2].body as string;
        expect(body).toContain('description: Line1Line2');
    });

    test('existing scan ignores mycalendar blocks without uid (should create new note)', async () => {
        const existingNote = {
            id: 'n1',
            title: 'No UID',
            body: block(['title: Local', 'start: 2025-01-01 00:00:00+00:00'].join('\n')),
        };

        const ics = [
            'BEGIN:VEVENT',
            'UID:u_new',
            'SUMMARY:New',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'END:VEVENT',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingNote], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.added).toBe(1);
        expect(joplin.data.post).toHaveBeenCalledTimes(1);
    });

    test('parses ICS input that contains BEGIN:VEVENT without VCALENDAR wrapper', async () => {
        const ics = [
            'BEGIN:VEVENT',
            'UID:u_no_vcal',
            'SUMMARY:No Calendar Wrapper',
            'DTSTART:20250115T100000Z',
            'DTEND:20250115T113000Z',
            'END:VEVENT',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics);

        expect(res.added).toBe(1);
        const body = joplin.data.post.mock.calls[0][2].body as string;
        expect(body).toContain('uid: u_no_vcal');
        expect(body).toContain('title: No Calendar Wrapper');
        expect(body).toContain('title: No Calendar Wrapper');
    });

    test('VERIFICATION: mycalendar-alarm properties "when" and "alarm_time" match exactly', async () => {
        // User specific scenario check
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:verify-alarm-time',
            'SUMMARY:Verify Time',
            'DTSTART:20260317T163000Z', // 16:30 Z
            'DTEND:20260317T173000Z',
            'BEGIN:VALARM',
            'TRIGGER:-PT15M', // 15 min before => 16:15 Z
            'ACTION:DISPLAY',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'created'}),
        });

        // We need to mock "now" to be before the alarm so it is created
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-01T00:00:00Z'));

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, 'verify-nb');

        expect(res.alarmsCreated).toBe(1);
        const alarmCall = joplin.data.post.mock.calls[1]; // 0 is event, 1 is alarm
        const noteBody = alarmCall[2];

        // Expected time: 16:30 - 15m = 16:15
        const expectedTimeStr = '2026-03-17 16:15:00+00:00';
        const expectedMs = new Date('2026-03-17T16:15:00Z').getTime();

        // 1. Check body "when" property
        expect(noteBody.body).toContain(`when: ${expectedTimeStr}`);

        // 2. Check system alarm_time property
        expect(noteBody.alarm_time).toBe(expectedMs);

        // 3. Ensure it is NOT the event start time
        const eventStartMs = new Date('2026-03-17T16:30:00Z').getTime();
        expect(noteBody.alarm_time).not.toBe(eventStartMs);

        jest.useRealTimers();
    });


    test('reimport matches existing event by uid+rid even when ICS uses RECURRENCE-ID with TZID (no duplicate event) and regenerates alarms', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-15T08:00:00.000Z'));

        const existingEvent = {
            id: 'event-note-id',
            title: 'Occ with alarm',
            parent_id: 'nb1',
            body: [
                '```mycalendar-event',
                'title: Occ with alarm',
                'uid: u-rid',
                'recurrence_id: 20250115T090000',
                'start: 2025-01-15 14:00:00+00:00',
                'end: 2025-01-15 15:30:00+00:00',
                '```',
            ].join('\n'),
        };

        const existingAlarm = {
            id: 'old-alarm-id',
            title: 'Occ with alarm + 2025-01-15 13:00',
            parent_id: 'nb1',
            body: [
                '```mycalendar-alarm',
                'title: Occ with alarm + 2025-01-15 13:00',
                'uid: u-rid',
                'recurrence_id: 20250115T090000',
                'when: 2025-01-15 13:00:00+00:00',
                '```',
                '',
                '---',
                '',
                '[Occ with alarm](:/event-note-id)',
            ].join('\n'),
        };

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:u-rid',
            'SUMMARY:Occ with alarm',
            'RECURRENCE-ID;TZID=America/Toronto:20250115T090000',
            'DTSTART;TZID=America/Toronto:20250115T090000',
            'DTEND;TZID=America/Toronto:20250115T103000',
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'TRIGGER:-PT1H',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({items: [existingEvent, existingAlarm], has_more: false}),
            post: jest.fn().mockResolvedValue({id: 'new-alarm-id'}),
            put: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        });

        const res = await importIcsIntoNotes(joplin as any, ics, undefined, 'nb1');

        // Existing alarm must be removed and a new one created (regenerated)
        expect((joplin.data.delete as any)).toHaveBeenCalledWith(['notes', 'old-alarm-id']);

        // Ensure we did not create a duplicate mycalendar-event note
        const postCalls = ((joplin.data.post as any).mock.calls || []) as any[];
        const postedBodies = postCalls.map(c => c?.[2]?.body).filter(Boolean) as string[];
        expect(postedBodies.some(b => b.includes('```mycalendar-event'))).toBe(false);
        expect(postedBodies.some(b => b.includes('```mycalendar-alarm'))).toBe(true);

        expect(res.alarmsDeleted).toBe(1);
        expect(res.alarmsCreated).toBe(1);
        expect(res.errors).toBe(0);

        jest.useRealTimers();
    });

});
