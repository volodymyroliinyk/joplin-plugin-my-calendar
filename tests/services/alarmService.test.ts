// tests/services/alarmService.test.ts
//
// src/main/services/alarmService.ts
//
// TZ=UTC npx jest tests/services/alarmService.test.ts --runInBand --no-cache;

import {syncAlarmsForEvents} from '../../src/main/services/alarmService';
import {Joplin} from '../../src/main/types/joplin.interface';
import {IcsEvent} from '../../src/main/types/icsTypes';
import * as joplinNoteService from '../../src/main/services/joplinNoteService';
import * as settings from '../../src/main/settings/settings';

import * as occurrenceService from '../../src/main/services/occurrenceService';
import * as dateTimeUtils from '../../src/main/utils/dateTimeUtils';
import * as noteBuilder from '../../src/main/services/noteBuilder';

// Mock dependencies
jest.mock('../../src/main/services/joplinNoteService');
jest.mock('../../src/main/settings/settings');
jest.mock('../../src/main/services/occurrenceService');
jest.mock('../../src/main/utils/dateTimeUtils');
jest.mock('../../src/main/services/noteBuilder');

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
        // Default mocks for deterministic tests
        (occurrenceService.expandOccurrences as jest.Mock).mockImplementation((_ev, _now, _end) => {
            return [{start: new Date('2026-01-30T12:00:00.000Z')}];
        });
        (dateTimeUtils.computeAlarmWhen as jest.Mock).mockImplementation((_alarm, occ) => {
            // Alarm at 11:45Z (15 minutes before 12:00Z)
            return new Date((occ.start as Date).getTime() - 15 * 60_000);
        });
        (dateTimeUtils.formatAlarmTitleTime as jest.Mock).mockReturnValue('12:00');
        (dateTimeUtils.formatDateForAlarm as jest.Mock).mockReturnValue('2026-01-30 11:45');
        (dateTimeUtils.addDays as jest.Mock).mockImplementation((d: Date, days: number) => new Date(d.getTime() + days * 86400_000));
        (dateTimeUtils.formatTriggerDescription as jest.Mock).mockReturnValue('15 minutes before');
        (noteBuilder.buildAlarmBody as jest.Mock).mockReturnValue('BODY_V1');
    });

    afterEach(() => {
        jest.useRealTimers();
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
        // Set "now" to be before the event/alarm so they are valid
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
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

        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(), body: 'old body'}]
        };
        // Make sure buildAlarmBody returns something that contains trigger_desc (this test asserts it)
        (noteBuilder.buildAlarmBody as jest.Mock).mockReturnValue('trigger_desc: 15 minutes before');

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1',
            undefined,
            undefined, // importAlarmRangeDays
            true // alarmsEnabled
        );

        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect(mockUpdateNote).toHaveBeenCalledWith(mockJoplin, 'alarm1', {body: expect.any(String)});
        const updatedBody = mockUpdateNote.mock.calls[0][2].body;
        expect(updatedBody).toContain('trigger_desc: 15 minutes before');

        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should NOT update existing alarm if body is already up-to-date', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
            valarms: [{action: 'DISPLAY', trigger: '-PT15M', related: 'START'}]
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};

        // buildAlarmBody mocked to BODY_V1, so set existing body to same value
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(), body: 'BODY_V1'}]
        };

        await syncAlarmsForEvents(mockJoplin, events, importedEventNotes, existingAlarms, 'folder1', undefined, undefined, true);

        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should delete invalid alarms that do not match desired alarms', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        (dateTimeUtils.computeAlarmWhen as jest.Mock).mockReturnValueOnce(new Date('2026-01-30T11:45:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
            valarms: [{action: 'DISPLAY', trigger: '-PT15M', related: 'START'}]
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};

        // existing alarm has different todo_due, so it should be deleted as "invalid"
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: new Date('2026-01-30T11:40:00.000Z').getTime(), body: 'old'}]
        };

        await syncAlarmsForEvents(mockJoplin, events, importedEventNotes, existingAlarms, 'folder1', undefined, undefined, true);

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockCreateNote).toHaveBeenCalledTimes(1);
    });

    it('should create missing alarms when none exist', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        mockCreateNote.mockResolvedValue({id: 'newAlarm1'});
        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
            valarms: [{action: 'DISPLAY', trigger: '-PT15M', related: 'START'}]
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};
        const existingAlarms = {[key]: []};

        await syncAlarmsForEvents(mockJoplin, events, importedEventNotes, existingAlarms, 'folder1', undefined, undefined, true);

        expect(mockCreateNote).toHaveBeenCalledTimes(1);
        expect(mockCreateNote.mock.calls[0][1]).toMatchObject({
            title: expect.any(String),
            body: 'BODY_V1',
            parent_id: 'folder1',
            is_todo: 1,
            todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(),
            alarm_time: new Date('2026-01-30T11:45:00.000Z').getTime(),
        });
        // todo_due post-update saved (if we leave the workaround)
        expect(mockUpdateNote).toHaveBeenCalledWith(mockJoplin, 'newAlarm1', {
            todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(),
            alarm_time: new Date('2026-01-30T11:45:00.000Z').getTime()
        });
    });

    it('should empty trash when alarms were deleted and setting is enabled', async () => {
        mockGetEmptyTrash.mockResolvedValue(true);
        const events: IcsEvent[] = [{uid: 'uid1', recurrence_id: '', start: '2026-01-30 12:00', valarms: []}];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Event 1', parent_id: 'folder1'}};
        const existingAlarms = {
            [key]: [{
                id: 'alarm1',
                todo_due: new Date('2000-01-01T00:00:00.000Z').getTime(),
                body: ''
            }]
        };

        await syncAlarmsForEvents(mockJoplin, events, importedEventNotes, existingAlarms, 'folder1');

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockJoplin.commands.execute).toHaveBeenCalledWith('emptyTrash');
    });

    it('should skip events without uid / without imported note / without notebook', async () => {
        const events: IcsEvent[] = [
            {uid: '', recurrence_id: '', start: '2026-01-30 12:00', valarms: []},
            {uid: 'uid2', recurrence_id: '', start: '2026-01-30 12:00', valarms: []},
            {uid: 'uid3', recurrence_id: '', start: '2026-01-30 12:00', valarms: []},
        ];
        const importedEventNotes = {
            // uid2 missing completely (should skip)
            ['uid3|']: {id: 'note3', title: 'Event 3'} // missing parent_id and no targetFolderId => skip
        };
        const existingAlarms = {};

        await syncAlarmsForEvents(mockJoplin, events, importedEventNotes, existingAlarms);

        expect(mockDeleteNote).not.toHaveBeenCalled();
        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should delete existing alarms and NOT create new ones if alarmsEnabled is false', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
            valarms: [{action: 'DISPLAY', trigger: '-PT15M', related: 'START'}]
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};

        // Existing alarm matches the event
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(), body: 'some body'}]
        };

        // Call with alarmsEnabled = false
        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1',
            undefined,
            undefined,
            false // alarmsEnabled
        );

        // Should delete the existing alarm because alarms are disabled
        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');

        // Should NOT create any new alarms
        expect(mockCreateNote).not.toHaveBeenCalled();
        expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    it('options object: alarmsEnabled=false takes precedence over legacy param and creates no alarms', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 12:00',
            valarms: [{action: 'DISPLAY', trigger: '-PT15M', related: 'START'}],
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};
        const existingAlarms = {
            [key]: [{id: 'alarm1', todo_due: new Date('2026-01-30T11:45:00.000Z').getTime(), body: 'old'}],
        };

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1',
            undefined,
            {alarmsEnabled: false},
            true // legacy param should be ignored because options specified alarmsEnabled
        );

        expect(mockDeleteNote).toHaveBeenCalledWith(mockJoplin, 'alarm1');
        expect(mockCreateNote).not.toHaveBeenCalled();
        expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    it('accepts alarmRangeDays=0 (only alarms due now..today) without falling back to settings', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-30T10:00:00.000Z'));

        const events: IcsEvent[] = [{
            uid: 'uid1',
            recurrence_id: '',
            title: 'Test Event',
            start: '2026-01-30 10:10',
            valarms: [{action: 'DISPLAY', trigger: '-PT0M', related: 'START'}],
        }];
        const key = 'uid1|';
        const importedEventNotes = {[key]: {id: 'note1', title: 'Test Event', parent_id: 'folder1'}};
        const existingAlarms = {[key]: []};

        // computeAlarmWhen mock returns start-15m by default; override to return exactly now (within window)
        (dateTimeUtils.computeAlarmWhen as jest.Mock).mockReturnValueOnce(new Date('2026-01-30T10:00:00.000Z'));

        await syncAlarmsForEvents(
            mockJoplin,
            events,
            importedEventNotes,
            existingAlarms,
            'folder1',
            undefined,
            {alarmRangeDays: 0},
        );

        expect(mockGetAlarmRange).not.toHaveBeenCalled();
        expect(mockCreateNote).toHaveBeenCalledTimes(1);
    });
});
