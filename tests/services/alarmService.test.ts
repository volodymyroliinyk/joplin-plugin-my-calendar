// tests/services/alarmService.test.ts
// src/main/services/alarmService.ts
//
// npx jest tests/services/alarmService.test.ts --runInBand --no-cache;

import {syncAlarmsForEvents} from '../../src/main/services/alarmService';
import {Joplin} from '../../src/main/types/joplin.interface';
import {IcsEvent} from '../../src/main/types/icsTypes';
import * as joplinNoteService from '../../src/main/services/joplinNoteService';
import * as settings from '../../src/main/settings/settings';

// Mock dependencies
jest.mock('../../src/main/services/joplinNoteService');
jest.mock('../../src/main/settings/settings');

describe('alarmService', () => {
    let mockJoplin: Joplin;
    const mockDeleteNote = joplinNoteService.deleteNote as jest.Mock;
    const mockCreateNote = joplinNoteService.createNote as jest.Mock;
    const mockUpdateNote = joplinNoteService.updateNote as jest.Mock;
    const mockGetAlarmRange = settings.getIcsImportAlarmRangeDays as jest.Mock;
    const mockGetEmptyTrash = settings.getIcsImportEmptyTrashAfter as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockJoplin = {
            data: {
                post: jest.fn(),
                put: jest.fn(),
                delete: jest.fn(),
                get: jest.fn(),
            },
            commands: {
                execute: jest.fn(),
            }
        } as unknown as Joplin;

        mockGetAlarmRange.mockResolvedValue(30);
        mockGetEmptyTrash.mockResolvedValue(false);
    });

    it('should delete outdated alarms (< now)', async () => {
        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            start: '2025-01-01 10:00',
            valarms: []
        }];
        const key = 'uid1|';

        const importedEventNotes = {
            [key]: {id: 'note1', title: 'Event 1', parent_id: 'folder1'}
        };

        const pastDate = new Date().getTime() - 10000;
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: pastDate, body: ''}]
        };

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
    });

    it('should update existing alarm if body is outdated', async () => {
        const now = new Date();
        const future = new Date(now.getTime() + 3600000);
        
        const pad = (n: number) => String(n).padStart(2, '0');
        const futureStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())} ${pad(future.getHours())}:${pad(future.getMinutes())}`;

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: futureStr,
            valarms: [{
                action: 'DISPLAY',
                trigger: '-PT15M',
                related: 'START'
            }]
        }];

        const key = 'uid1|';
        const importedEventNotes = {
            [key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}
        };

        future.setSeconds(0, 0);
        
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: future.getTime() - 15 * 60000, body: 'old body'}]
        };

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect(mockUpdateNote).toHaveBeenCalledWith(mockJoplin, 'alarm1', {body: expect.any(String)});
        const updatedBody = mockUpdateNote.mock.calls[0][2].body;
        expect(updatedBody).toContain('trigger_desc: 15 minutes before');
        
        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });
});
