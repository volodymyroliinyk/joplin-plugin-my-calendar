import {startScheduledIcsImport} from '../../src/main/services/scheduledIcsImportService';

jest.mock('../../src/main/settings/settings', () => ({
    getScheduledIcsImportEntries: jest.fn(),
    getScheduledIcsImportIntervalMinutes: jest.fn(),
    getIcsImportAlarmRangeDays: jest.fn(),
    getDefaultEventColor: jest.fn(),
}));

jest.mock('../../src/main/services/icsImportService', () => ({
    importIcsIntoNotes: jest.fn(),
}));

jest.mock('../../src/main/services/folderService', () => ({
    getAllFolders: jest.fn(),
    resolveFolderIdByTitle: jest.fn(),
}));

jest.mock('../../src/main/services/eventsCache', () => ({
    invalidateAllEventsCache: jest.fn(),
}));

jest.mock('../../src/main/utils/toast', () => ({
    showToast: jest.fn(),
}));

jest.mock('../../src/main/utils/logger', () => ({
    dbg: jest.fn(),
    err: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
}));

import {
    getScheduledIcsImportIntervalMinutes,
    getScheduledIcsImportEntries,
    getIcsImportAlarmRangeDays,
    getDefaultEventColor,
} from '../../src/main/settings/settings';
import {getAllFolders, resolveFolderIdByTitle} from '../../src/main/services/folderService';
import {importIcsIntoNotes} from '../../src/main/services/icsImportService';
import {invalidateAllEventsCache} from '../../src/main/services/eventsCache';
import {showToast} from '../../src/main/utils/toast';
import {dbg, log} from '../../src/main/utils/logger';

describe('scheduledIcsImportService', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();

        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url: 'https://example.com/a.ics', notebookTitle: 'Work'},
        ]);
        (getScheduledIcsImportIntervalMinutes as jest.Mock).mockResolvedValue(15);
        (getIcsImportAlarmRangeDays as jest.Mock).mockResolvedValue(30);
        (getDefaultEventColor as jest.Mock).mockResolvedValue('');
        (getAllFolders as jest.Mock).mockResolvedValue([{id: 'folder-1', title: 'Work', parent_id: null}]);
        (resolveFolderIdByTitle as jest.Mock).mockReturnValue({folderId: 'folder-1'});
        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 1,
            updated: 2,
            skipped: 3,
            errors: 0,
            alarmsCreated: 4,
            alarmsDeleted: 5,
            alarmsUpdated: 6,
            issues: 0,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('starts on desktop and imports only after the configured interval elapses', async () => {
        const onAfterImport = jest.fn();
        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        const controller = await startScheduledIcsImport(joplin as any, {onAfterImport, downloadIcs});

        expect(downloadIcs).not.toHaveBeenCalled();
        expect(importIcsIntoNotes).not.toHaveBeenCalled();
        expect(invalidateAllEventsCache).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
        expect(onAfterImport).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(downloadIcs).toHaveBeenCalledWith('https://example.com/a.ics');
        expect(importIcsIntoNotes).toHaveBeenCalledWith(
            joplin,
            'BEGIN:VCALENDAR\nEND:VCALENDAR',
            expect.any(Function),
            'folder-1',
            true,
            undefined,
            30,
        );
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(
            'success',
            'Scheduled ICS import finished for Work: added=1, updated=2, skipped=3, errors=0, alarmsCreated=4, alarmsDeleted=5',
            5000,
        );
        expect(onAfterImport).toHaveBeenCalledWith({
            added: 1,
            updated: 2,
            skipped: 3,
            errors: 0,
            alarmsCreated: 4,
            alarmsDeleted: 5,
            alarmsUpdated: 6,
            issues: 0,
        });
        expect(importIcsIntoNotes).toHaveBeenCalledTimes(1);
        controller.stop();
    });

    test('runNow imports immediately without resetting the scheduled interval', async () => {
        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'})};
        const controller = await startScheduledIcsImport(joplin as any, {downloadIcs});

        await controller.runNow();

        expect(downloadIcs).toHaveBeenCalledTimes(1);
        expect(importIcsIntoNotes).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(downloadIcs).toHaveBeenCalledTimes(2);
        controller.stop();
    });

    test('does not start scheduled import on mobile', async () => {
        const downloadIcs = jest.fn();
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'mobile'}),
        };

        const controller = await startScheduledIcsImport(joplin as any, {downloadIcs});
        await controller.runNow();

        expect(downloadIcs).not.toHaveBeenCalled();
        expect(importIcsIntoNotes).not.toHaveBeenCalled();
    });

    test('refresh disables scheduler when there are no valid URLs', async () => {
        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        const controller = await startScheduledIcsImport(joplin as any, {downloadIcs});
        expect(importIcsIntoNotes).not.toHaveBeenCalled();

        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([]);
        await controller.refresh();

        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(importIcsIntoNotes).not.toHaveBeenCalled();
    });

    test('continues with next URL when one download fails and still invalidates cache after successful imports', async () => {
        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url: 'https://example.com/a.ics', notebookTitle: 'Work'},
            {url: 'https://example.com/b.ics', notebookTitle: 'Personal'},
        ]);
        const downloadIcs = jest.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('BEGIN:VCALENDAR\nEND:VCALENDAR');

        const onAfterImport = jest.fn();
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {onAfterImport, downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(importIcsIntoNotes).toHaveBeenCalledTimes(1);
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(
            'error',
            'Scheduled ICS import failed for Work: boom',
            5000,
        );
        expect(showToast).toHaveBeenCalledWith(
            'success',
            'Scheduled ICS import finished for Personal: added=1, updated=2, skipped=3, errors=0, alarmsCreated=4, alarmsDeleted=5',
            5000,
        );
        expect(onAfterImport).toHaveBeenCalledWith({
            added: 1,
            updated: 2,
            skipped: 3,
            errors: 1,
            alarmsCreated: 4,
            alarmsDeleted: 5,
            alarmsUpdated: 6,
            issues: 0,
        });
    });

    test('shows warning toast when import completes with errors in result payload', async () => {
        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 1,
            updated: 0,
            skipped: 0,
            errors: 2,
            alarmsCreated: 0,
            alarmsDeleted: 0,
            alarmsUpdated: 0,
            issues: 3,
        });

        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(showToast).toHaveBeenCalledWith(
            'warning',
            'Scheduled ICS import finished for Work: added=1, updated=0, skipped=0, errors=2, alarmsCreated=0, alarmsDeleted=0, issues=3',
            5000,
        );
    });

    test('passes configured default event color only to scheduled imports', async () => {
        (getDefaultEventColor as jest.Mock).mockResolvedValue('#00ff00');

        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(importIcsIntoNotes).toHaveBeenCalledWith(
            joplin,
            'BEGIN:VCALENDAR\nEND:VCALENDAR',
            expect.any(Function),
            'folder-1',
            true,
            '#00ff00',
            30,
        );
    });

    test('shows error toast when notebook title cannot be resolved', async () => {
        (resolveFolderIdByTitle as jest.Mock).mockReturnValue({reason: 'Notebook title "Work" was not found'});

        const downloadIcs = jest.fn();
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(downloadIcs).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
            'error',
            'Scheduled ICS import failed for Work: Notebook title "Work" was not found',
            5000,
        );
    });

    test('defers refreshed settings until the active cycle finishes', async () => {
        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        const controller = await startScheduledIcsImport(joplin as any, {downloadIcs});

        let resolveDownload!: (value: string) => void;
        const slowDownload = new Promise<string>((resolve) => {
            resolveDownload = resolve;
        });
        downloadIcs.mockReset();
        downloadIcs.mockReturnValueOnce(slowDownload).mockResolvedValueOnce('BEGIN:VCALENDAR\nEND:VCALENDAR');

        (showToast as jest.Mock).mockClear();
        (importIcsIntoNotes as jest.Mock).mockClear();
        (invalidateAllEventsCache as jest.Mock).mockClear();

        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url: 'https://example.com/new.ics', notebookTitle: 'Work'},
        ]);

        const refreshPromise = controller.refresh();
        resolveDownload('BEGIN:VCALENDAR\nEND:VCALENDAR');
        await refreshPromise;
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(showToast).toHaveBeenCalledTimes(2);
        expect(showToast).toHaveBeenNthCalledWith(1,
            'success',
            'Scheduled ICS import finished for Work: added=1, updated=2, skipped=3, errors=0, alarmsCreated=4, alarmsDeleted=5',
            5000,
        );
        expect(showToast).toHaveBeenNthCalledWith(2,
            'success',
            'Scheduled ICS import finished for Work: added=1, updated=2, skipped=3, errors=0, alarmsCreated=4, alarmsDeleted=5',
            5000,
        );
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(2);
    });

    test('refresh while note import is pending still invalidates cache after it resolves', async () => {
        let resolveImport!: (value: any) => void;
        (importIcsIntoNotes as jest.Mock).mockReturnValue(new Promise((resolve) => {
            resolveImport = resolve;
        }));
        const onAfterImport = jest.fn();
        const controller = await startScheduledIcsImport(
            {versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'})} as any,
            {downloadIcs: jest.fn().mockResolvedValue('ICS'), onAfterImport},
        );

        const runPromise = controller.runNow();
        await Promise.resolve();
        await Promise.resolve();
        const refreshPromise = controller.refresh();
        expect(invalidateAllEventsCache).not.toHaveBeenCalled();

        resolveImport({
            added: 1, updated: 0, skipped: 0, errors: 0,
            alarmsCreated: 0, alarmsDeleted: 0, alarmsUpdated: 0, issues: 0,
        });
        await runPromise;
        await refreshPromise;

        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(onAfterImport).toHaveBeenCalledWith(expect.objectContaining({added: 1}));
        controller.stop();
    });

    test('refresh between configured feeds lets the active snapshot finish with a complete summary', async () => {
        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url: 'https://example.com/a.ics', notebookTitle: 'Work'},
            {url: 'https://example.com/b.ics', notebookTitle: 'Personal'},
        ]);
        let resolveFirst!: (value: any) => void;
        (importIcsIntoNotes as jest.Mock)
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce({
                added: 0, updated: 2, skipped: 0, errors: 0,
                alarmsCreated: 0, alarmsDeleted: 0, alarmsUpdated: 0, issues: 0,
            });
        const onAfterImport = jest.fn();
        const controller = await startScheduledIcsImport(
            {versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'})} as any,
            {downloadIcs: jest.fn().mockResolvedValue('ICS'), onAfterImport},
        );

        const runPromise = controller.runNow();
        await Promise.resolve();
        await Promise.resolve();
        const refreshPromise = controller.refresh();
        resolveFirst({
            added: 1, updated: 0, skipped: 0, errors: 0,
            alarmsCreated: 0, alarmsDeleted: 0, alarmsUpdated: 0, issues: 0,
        });
        await runPromise;
        await refreshPromise;

        expect(importIcsIntoNotes).toHaveBeenCalledTimes(2);
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(onAfterImport).toHaveBeenCalledWith(expect.objectContaining({added: 1, updated: 2}));
        controller.stop();
    });

    test('dispose during an active import still finalizes completed mutations', async () => {
        let resolveImport!: (value: any) => void;
        (importIcsIntoNotes as jest.Mock).mockReturnValue(new Promise((resolve) => {
            resolveImport = resolve;
        }));
        const onAfterImport = jest.fn();
        const controller = await startScheduledIcsImport(
            {versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'})} as any,
            {downloadIcs: jest.fn().mockResolvedValue('ICS'), onAfterImport},
        );

        const runPromise = controller.runNow();
        for (let i = 0; i < 10 && (importIcsIntoNotes as jest.Mock).mock.calls.length === 0; i++) {
            await Promise.resolve();
        }
        expect(importIcsIntoNotes).toHaveBeenCalledTimes(1);
        controller.stop();
        resolveImport({
            added: 1, updated: 0, skipped: 0, errors: 0,
            alarmsCreated: 0, alarmsDeleted: 0, alarmsUpdated: 0, issues: 0,
        });
        await runPromise;

        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(onAfterImport).toHaveBeenCalledWith(expect.objectContaining({added: 1}));
    });

    test('masks query params in error toast text when an error message includes the URL', async () => {
        const url = 'https://example.com/a.ics?token=secret&user=alice';
        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url, notebookTitle: 'Work'},
        ]);
        const downloadIcs = jest.fn().mockRejectedValue(new Error(`Failed to fetch ${url}`));
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(showToast).toHaveBeenCalledWith(
            'error',
            'Scheduled ICS import failed for Work: Failed to fetch https://example.com/a.ics?token=%5Bredacted%5D&user=%5Bredacted%5D',
            5000,
        );
    });

    test('masks query params in scheduled import logs', async () => {
        (getScheduledIcsImportEntries as jest.Mock).mockResolvedValue([
            {url: 'https://example.com/a.ics?token=secret', notebookTitle: 'Work'},
        ]);
        (importIcsIntoNotes as jest.Mock).mockImplementation(
            async (_joplin: any, _ics: string, onStatus: (text: string) => Promise<void>) => {
                await onStatus('Parsed 0 VEVENT(s)');
                return {
                    added: 0,
                    updated: 0,
                    skipped: 0,
                    errors: 0,
                    alarmsCreated: 0,
                    alarmsDeleted: 0,
                    alarmsUpdated: 0,
                    issues: 0,
                };
            },
        );
        const downloadIcs = jest.fn().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR');
        const joplin = {
            versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
        };

        await startScheduledIcsImport(joplin as any, {downloadIcs});
        await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

        expect(log).toHaveBeenCalledWith(
            'scheduledIcsImport',
            'Downloading ICS from https://example.com/a.ics?token=%5Bredacted%5D',
        );
        expect(dbg).toHaveBeenCalledWith(
            'scheduledIcsImport',
            '[https://example.com/a.ics?token=%5Bredacted%5D] Parsed 0 VEVENT(s)',
        );
    });
});
