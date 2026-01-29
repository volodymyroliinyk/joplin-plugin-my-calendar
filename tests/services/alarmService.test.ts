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

    it('should delete old alarms but NOT empty trash if setting is disabled', async () => {
        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            start: '2025-01-01 10:00',
            valarms: []
        }];
        // Key format is "uid|recurrence_id" -> "uid1|"
        const key = 'uid1|';

        const importedEventNotes = {
            [key]: {id: 'note1', title: 'Event 1', parent_id: 'folder1'}
        };
        const existingAlarms = {
            [key]: ['alarm1']
        };

        mockGetEmptyTrash.mockResolvedValue(false);

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockJoplin.commands.execute).not.toHaveBeenCalledWith('emptyTrash');
    });

    it('should delete old alarms AND empty trash if setting is enabled', async () => {
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
        const existingAlarms = {
            [key]: ['alarm1']
        };

        mockGetEmptyTrash.mockResolvedValue(true);

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockJoplin.commands.execute).toHaveBeenCalledWith('emptyTrash');
    });

    it('should NOT empty trash if no alarms were deleted, even if setting is enabled', async () => {
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
        const existingAlarms = {}; // No existing alarms

        mockGetEmptyTrash.mockResolvedValue(true);

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1'
        );

        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockJoplin.commands.execute).not.toHaveBeenCalledWith('emptyTrash');
    });
});
