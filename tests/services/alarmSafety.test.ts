import {importIcsIntoNotes} from '../../src/main/services/icsImportService';
import * as settings from '../../src/main/settings/settings';

jest.mock('../../src/main/settings/settings', () => {
    const original = jest.requireActual('../../src/main/settings/settings');
    return {
        ...original,
        getIcsImportAlarmsEnabled: jest.fn(),
        getIcsImportAlarmRangeDays: jest.fn(),
        getIcsImportEmptyTrashAfter: jest.fn(),
    };
});

const mkJoplin = (impl?: any) => ({
    data: {
        get: impl?.get ?? jest.fn(),
        put: impl?.put ?? jest.fn(),
        post: impl?.post ?? jest.fn(),
        delete: impl?.delete ?? jest.fn(),
    },
    settings: {
        value: jest.fn().mockResolvedValue(30),
    },
    commands: {
        execute: jest.fn(),
    }
});

describe('Alarm Deletion Safety', () => {
    beforeEach(() => {
        (settings.getIcsImportAlarmsEnabled as jest.Mock).mockResolvedValue(true);
        (settings.getIcsImportAlarmRangeDays as jest.Mock).mockResolvedValue(30);
        (settings.getIcsImportEmptyTrashAfter as jest.Mock).mockResolvedValue(false);
    });

    test('should NOT delete unrelated notes or alarms of other events during sync', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-15T08:00:00.000Z'));

        // 1. Existing notes structure
        const eventANote = {
            id: 'note-a',
            title: 'Event A',
            parent_id: 'folder-1',
            body: '```mycalendar-event\nuid: uid-a\nstart: 2025-01-15 10:00:00+00:00\n```'
        };
        const alarmANote = {
            id: 'alarm-a-old',
            title: 'Alarm A',
            parent_id: 'folder-1',
            todo_due: new Date('2025-01-15T09:00:00.000Z').getTime(),
            body: '```mycalendar-alarm\nuid: uid-a\nalarm_at: 2025-01-15 09:00:00+00:00\n```'
        };
        const unrelatedNote = {
            id: 'unrelated',
            title: 'Shopping List',
            parent_id: 'folder-1',
            body: 'Buy milk and eggs'
        };
        const alarmBNote = {
            id: 'alarm-b',
            title: 'Alarm B',
            parent_id: 'folder-1',
            todo_due: new Date('2025-01-15T11:00:00.000Z').getTime(),
            body: '```mycalendar-alarm\nuid: uid-b\nalarm_at: 2025-01-15 11:00:00+00:00\n```'
        };

        // 2. New ICS data for Event A only (with DIFFERENT alarm time)
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:uid-a',
            'SUMMARY:Event A',
            'DTSTART:20250115T100000Z',
            'BEGIN:VALARM',
            'TRIGGER:-PT30M', // 30 mins instead of 1h
            'ACTION:DISPLAY',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const deletedIds: string[] = [];
        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [eventANote, alarmANote, unrelatedNote, alarmBNote],
                has_more: false
            }),
            delete: jest.fn().mockImplementation((path) => {
                deletedIds.push(path[1]);
                return Promise.resolve({});
            }),
            post: jest.fn().mockResolvedValue({id: 'new-alarm-id'}),
            put: jest.fn().mockResolvedValue({}),
        });

        // 3. Execution
        const res = await importIcsIntoNotes(joplin as any, ics);

        // 4. Verification
        // - Older alarm for A should be deleted
        expect(deletedIds).toContain('alarm-a-old');
        // - Unrelated note MUST NOT be deleted
        expect(deletedIds).not.toContain('unrelated');
        // - Alarm for B MUST NOT be deleted (since uid-b was not in the imported ICS)
        // Wait, if uid-b is not in the imported ICS, it should actually stay!
        expect(deletedIds).not.toContain('alarm-b');

        expect(res.alarmsDeleted).toBe(1);
        expect(res.alarmsCreated).toBe(1);

        jest.useRealTimers();
    });

    test('should NOT touch alarm notes if their UID is not in the current ICS import (Multi-source safety)', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-15T08:00:00.000Z'));

        const existingAlarmC = {
            id: 'alarm-c',
            title: 'Alarm C',
            parent_id: 'folder-1',
            todo_due: new Date('2025-01-15T12:00:00.000Z').getTime(),
            body: '```mycalendar-alarm\nuid: uid-c\nalarm_at: 2025-01-15 12:00:00+00:00\n```'
        };

        const icsForA = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:uid-a',
            'SUMMARY:Event A',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const deletedIds: string[] = [];
        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [
                    {
                        id: 'note-a',
                        title: 'Event A',
                        parent_id: 'folder-1',
                        body: '```mycalendar-event\nuid: uid-a\nstart: 2025-01-15 10:00:00+00:00\n```'
                    },
                    existingAlarmC
                ],
                has_more: false
            }),
            delete: jest.fn().mockImplementation((path) => {
                deletedIds.push(path[1]);
                return Promise.resolve({});
            }),
        });

        await importIcsIntoNotes(joplin as any, icsForA);

        // Alarm C should remain untouched because uid-c was not in the ICS
        expect(deletedIds).not.toContain('alarm-c');
        jest.useRealTimers();
    });

    test('should NOT index or delete alarm notes that are missing a UID (Safety)', async () => {
        const corruptedAlarm = {
            id: 'corrupted',
            title: 'Broken Alarm',
            parent_id: 'folder-1',
            body: '```mycalendar-alarm\nalarm_at: 2025-01-15 12:00:00+00:00\n```' // NO UID
        };

        const icsForA = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:uid-a',
            'SUMMARY:Event A',
            'DTSTART:20250115T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\n');

        const deletedIds: string[] = [];
        const joplin = mkJoplin({
            get: jest.fn().mockResolvedValue({
                items: [corruptedAlarm],
                has_more: false
            }),
            delete: jest.fn().mockImplementation((path) => {
                deletedIds.push(path[1]);
                return Promise.resolve({});
            }),
        });

        await importIcsIntoNotes(joplin as any, icsForA);

        expect(deletedIds).not.toContain('corrupted');
    });
});
