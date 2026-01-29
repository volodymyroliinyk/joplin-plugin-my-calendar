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

        // Alarm in the past
        const pastDate = new Date().getTime() - 10000;
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: pastDate}]
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

    it('should keep valid future alarms', async () => {
        const now = new Date();
        const future = new Date(now.getTime() + 3600000); // +1 hour

        const pad = (n: number) => String(n).padStart(2, '0');
        const futureStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())} ${pad(future.getHours())}:${pad(future.getMinutes())}`;

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: futureStr,
            valarms: [{
                action: 'DISPLAY',
                trigger: '-PT0M', // Alarm at start time (0 minutes before)
                related: 'START'
            }]
        }];

        const key = 'uid1|';
        const importedEventNotes = {
            [key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}
        };

        future.setSeconds(0, 0);
        
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: future.getTime()}]
        };

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should delete invalid future alarms (time changed)', async () => {
        const now = new Date();
        const future = new Date(now.getTime() + 3600000); // +1 hour
        const wrongTime = new Date(now.getTime() + 7200000); // +2 hours

        const pad = (n: number) => String(n).padStart(2, '0');
        const futureStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())} ${pad(future.getHours())}:${pad(future.getMinutes())}`;

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            start: futureStr,
            valarms: [{
                action: 'DISPLAY',
                trigger: '-PT0M',
                related: 'START'
            }]
        }];

        const key = 'uid1|';
        const importedEventNotes = {
            [key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}
        };

        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: wrongTime.getTime()}]
        };

        mockCreateNote.mockResolvedValue({id: 'newAlarm'});

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockCreateNote).toHaveBeenCalled();
    });
});
