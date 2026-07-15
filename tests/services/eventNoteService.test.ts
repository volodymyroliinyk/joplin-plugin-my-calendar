import {
    CalendarEventValidationError,
    createCalendarEventNote,
    generateMyCalendarEventUid,
    normalizeCalendarEventFormPayload,
} from '../../src/main/services/eventNoteService';

describe('eventNoteService', () => {
    test('generates mycalendar event uid suffix', () => {
        expect(generateMyCalendarEventUid()).toMatch(/^[0-9a-f]{32}@mycalendarevent$/);
    });

    test('normalizes supported form fields for a recurring event', () => {
        const normalized = normalizeCalendarEventFormPayload({
            targetFolderId: 'folder_123',
            title: '  Weekly sync  ',
            start: '2026-06-16 10:00',
            end: '2026-06-16 11:00',
            tz: 'America/Toronto',
            color: '#AABBCC',
            location: ' Room 1 ',
            description: 'Line 1\nLine 2',
            repeat: 'weekly',
            repeat_interval: '2',
            repeat_until: '2026-12-31',
            byweekday: 'we,MO,WE',
            exdates: '2026-07-01 10:00\n2026-07-01 10:00,2026-08-01 10:00',
            tagIds: ['tag-a', 'tag-b', 'tag-a'],
        });

        expect(normalized.folderId).toBe('folder_123');
        expect(normalized.noteTitle).toBe('Weekly sync');
        expect(normalized.event).toMatchObject({
            title: 'Weekly sync',
            start: '2026-06-16 10:00',
            end: '2026-06-16 11:00',
            tz: 'America/Toronto',
            color: '#aabbcc',
            location: 'Room 1',
            description: 'Line 1\nLine 2',
            repeat: 'weekly',
            repeat_interval: 2,
            repeat_until: '2026-12-31',
            byweekday: 'MO,WE',
            exdates: ['2026-07-01 10:00', '2026-08-01 10:00'],
        });
        expect(normalized.event.uid).toMatch(/@mycalendarevent$/);
        expect(normalized.tagIds).toEqual(['tag-a', 'tag-b']);
    });

    test('rejects invalid folder, title, timezone, date, repeat fields', () => {
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: '../bad',
            title: 'x',
            start: '2026-01-01 10:00'
        }))
            .toThrow('Select a valid target notebook');
        expect(() => normalizeCalendarEventFormPayload({targetFolderId: 'f1', title: '', start: '2026-01-01 10:00'}))
            .toThrow('Title is required');
        expect(() => normalizeCalendarEventFormPayload({targetFolderId: 'f1', title: 'x', start: 'bad'}))
            .toThrow('Start date/time is invalid');
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'x',
            start: '2026-01-01 10:00',
            tz: 'Mars/Base'
        }))
            .toThrow('Timezone must be a valid IANA timezone');
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'x',
            start: '2026-01-01 10:00',
            repeat: 'weekly',
            byweekday: 'XX'
        }))
            .toThrow('Invalid weekday');
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'x',
            start: '2026-01-01 10:00',
            repeat: 'monthly',
            bymonthday: '32'
        }))
            .toThrow('Monthly repeat day');
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'x',
            start: '2026-01-01 10:00',
            tagIds: ['../bad']
        }))
            .toThrow('Selected tags contain an invalid tag id');
    });

    test('exposes stable field metadata for form validation errors', () => {
        try {
            normalizeCalendarEventFormPayload({
                targetFolderId: 'f1',
                title: 'Bad range',
                start: '2026-06-16 10:00',
                end: '2026-06-16 09:00',
            });
            throw new Error('Expected validation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(CalendarEventValidationError);
            expect(error).toMatchObject({
                code: 'end_before_start',
                field: 'endDate',
                message: 'End date/time must not be before start',
            });
        }
    });

    test('rejects unsafe recurrence limits instead of silently truncating them', () => {
        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'Weekly',
            start: '2026-06-16 10:00',
            repeat: 'weekly',
            repeat_interval: '0',
            byweekday: 'MO',
        })).toThrow('Repeat interval must be a whole number from 1 to 999');

        expect(() => normalizeCalendarEventFormPayload({
            targetFolderId: 'f1',
            title: 'Weekly',
            start: '2026-06-16 10:00',
            repeat: 'weekly',
            byweekday: 'MO',
            exdates: Array.from({length: 101}, (_, index) => `2027-01-${String((index % 28) + 1).padStart(2, '0')} 10:${String(index).padStart(2, '0')}`),
        })).toThrow('Use no more than 100 exclude dates');
    });

    test('normalizes all-day event creation to date-only start and exclusive end date', () => {
        const normalized = normalizeCalendarEventFormPayload({
            targetFolderId: 'folder_123',
            title: 'Conference',
            start: '2026-06-16',
            end: '2026-06-18',
            tz: 'America/Toronto',
            all_day: true,
        });

        expect(normalized.event).toMatchObject({
            title: 'Conference',
            start: '2026-06-16',
            end: '2026-06-19',
            tz: 'America/Toronto',
            all_day: true,
        });
    });

    test('normalizes same-day all-day event creation to one exclusive day', () => {
        const normalized = normalizeCalendarEventFormPayload({
            targetFolderId: 'folder_123',
            title: 'Holiday',
            start: '2026-06-16',
            end: '2026-06-16',
            all_day: true,
        });

        expect(normalized.event.start).toBe('2026-06-16');
        expect(normalized.event.end).toBe('2026-06-17');
    });

    test('createCalendarEventNote writes a sanitized mycalendar-event note', async () => {
        const joplin = {
            data: {
                post: jest.fn().mockResolvedValue({id: 'note1', title: 'Meeting', body: 'body', parent_id: 'folder1'}),
            },
        };

        const result = await createCalendarEventNote(joplin as any, {
            targetFolderId: 'folder1',
            title: 'Meeting ```',
            start: '2026-06-16 10:00',
            all_day: false,
            repeat: 'none',
        });

        expect(joplin.data.post).toHaveBeenCalledTimes(1);
        const [, , note] = joplin.data.post.mock.calls[0];
        expect(note.parent_id).toBe('folder1');
        expect(note.title).toBe("Meeting '''");
        expect(note.body).toContain('```mycalendar-event');
        expect(note.body).toContain("title: Meeting '''");
        expect(note.body).toContain('start: 2026-06-16 10:00');
        expect(note.body).toMatch(/uid: [0-9a-f]{32}@mycalendarevent/);
        expect(result.uid).toMatch(/@mycalendarevent$/);
    });

    test('createCalendarEventNote attaches selected Joplin tags after creating the note', async () => {
        const joplin = {
            data: {
                post: jest.fn()
                    .mockResolvedValueOnce({id: 'note1', title: 'Meeting', body: 'body', parent_id: 'folder1'})
                    .mockResolvedValueOnce({})
                    .mockResolvedValueOnce({}),
            },
        };

        const result = await createCalendarEventNote(joplin as any, {
            targetFolderId: 'folder1',
            title: 'Meeting',
            start: '2026-06-16 10:00',
            tagIds: ['tag-b', 'tag-a', 'tag-b'],
        });

        expect(joplin.data.post).toHaveBeenCalledTimes(3);
        expect(joplin.data.post).toHaveBeenNthCalledWith(2, ['tags', 'tag-b', 'notes'], null, {id: 'note1'});
        expect(joplin.data.post).toHaveBeenNthCalledWith(3, ['tags', 'tag-a', 'notes'], null, {id: 'note1'});
        expect(result.warnings).toEqual([]);
    });

    test.each([
        ['first', ['reject', 'resolve']],
        ['later', ['resolve', 'reject']],
    ])('tag attachment failure on the %s tag returns the created note and continues other tags', async (_position, outcomes) => {
        const tagPost = jest.fn();
        for (const outcome of outcomes) {
            if (outcome === 'reject') tagPost.mockRejectedValueOnce(new Error('tag API unavailable'));
            else tagPost.mockResolvedValueOnce({});
        }
        const post = jest.fn()
            .mockResolvedValueOnce({id: 'note1', title: 'Meeting', body: 'body', parent_id: 'folder1'})
            .mockImplementation(tagPost);
        const joplin = {data: {post}};

        const result = await createCalendarEventNote(joplin as any, {
            targetFolderId: 'folder1',
            title: 'Meeting',
            start: '2026-06-16 10:00',
            tagIds: ['tag-a', 'tag-b'],
        });

        expect(result.note.id).toBe('note1');
        expect(post).toHaveBeenCalledTimes(3);
        expect(post).toHaveBeenNthCalledWith(2, ['tags', 'tag-a', 'notes'], null, {id: 'note1'});
        expect(post).toHaveBeenNthCalledWith(3, ['tags', 'tag-b', 'notes'], null, {id: 'note1'});
        const failedTagId = outcomes[0] === 'reject' ? 'tag-a' : 'tag-b';
        expect(result.warnings).toEqual([{
            code: 'tag_attachment_failed',
            tagId: failedTagId,
            message: `Event note was created, but tag ${failedTagId} could not be attached: tag API unavailable`,
        }]);
    });
});
