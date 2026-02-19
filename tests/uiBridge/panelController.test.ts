// tests/uiBridge/panelController.test.ts
//
// src/main/uiBridge/panelController.ts
//
// TZ=UTC npx jest tests/uiBridge/panelController.test.ts --runInBand --no-cache;
//

import {registerCalendarPanelController} from '../../src/main/uiBridge/panelController';


jest.mock('../../src/main/uiBridge/uiSettings', () => ({
    pushUiSettings: jest.fn(),
}));


jest.mock('../../src/main/services/eventsCache', () => ({
    ensureAllEventsCache: jest.fn(),
    invalidateAllEventsCache: jest.fn(),
}));

jest.mock('../../src/main/services/icsImportService', () => ({
    importIcsIntoNotes: jest.fn(),
}));

jest.mock('../../src/main/utils/toast', () => ({
    showToast: jest.fn(),
}));

jest.mock('../../src/main/utils/logger', () => ({
    dbg: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    err: jest.fn(),
}));

import {ensureAllEventsCache, invalidateAllEventsCache} from '../../src/main/services/eventsCache';
import {importIcsIntoNotes} from '../../src/main/services/icsImportService';
import {showToast} from '../../src/main/utils/toast';
import {pushUiSettings} from '../../src/main/uiBridge/uiSettings';
import {dbg, err, info, log, warn} from '../../src/main/utils/logger';
import {SETTING_DEBUG, SETTING_WEEK_START, SETTING_ICS_IMPORT_ALARM_RANGE_DAYS} from "../../src/main/settings/settings";

type AnyFn = (...args: any[]) => any;

function makeJoplinMock() {
    const onMessage = jest.fn();
    const postMessage = jest.fn();
    const dataGet = jest.fn();
    const execute = jest.fn();

    const joplin = {
        settings: {
            value: jest.fn().mockImplementation(key => {
                if (key === SETTING_WEEK_START) {
                    return Promise.resolve('sunday');
                }
                if (key === SETTING_DEBUG) {
                    return Promise.resolve(false);
                }
                if (key === SETTING_ICS_IMPORT_ALARM_RANGE_DAYS) {
                    return Promise.resolve(30);
                }
                return Promise.resolve(null);
            }),
        },
        views: {
            panels: {
                onMessage,
                postMessage,
            },
        },
        data: {
            get: dataGet,
        },
        commands: {
            execute,
        },
    };

    return {joplin, onMessage, postMessage, dataGet, execute};
}

function makeHelpers() {
    return {
        expandAllInRange: jest.fn((events: any[], _fromUtc: number, _toUtc: number) => events),
        buildICS: jest.fn((events: any[]) => `ICS(${events.length})`),
    };
}

async function setup() {
    const {joplin, onMessage, postMessage, dataGet, execute} = makeJoplinMock();
    const helpers = makeHelpers();

    // onMessage should receive a callback that we will call in the tests
    let handler: AnyFn | null = null;
    onMessage.mockImplementation(async (_panelId: string, cb: AnyFn) => {
        handler = cb;
    });

    await registerCalendarPanelController(joplin as any, 'panel-1', helpers as any);

    if (!handler) throw new Error('onMessage handler was not registered');

    return {joplin, helpers, handler: handler as AnyFn, onMessage, postMessage, dataGet, execute};
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('panelController', () => {
    test('uiReady -> posts uiSettings and redrawMonth', async () => {
        const {handler, postMessage, joplin} = await setup();
        (pushUiSettings as jest.Mock).mockResolvedValue(undefined);
        await handler({name: 'uiReady'});

        expect(pushUiSettings).toHaveBeenCalledTimes(1);
        expect(pushUiSettings).toHaveBeenCalledWith(joplin, 'panel-1');

        expect(postMessage).not.toHaveBeenCalled();

    });

    test('uiLog -> forwards to logger with restored error', async () => {
        const {handler} = await setup();

        await handler({
            name: 'uiLog',
            source: 'calendar',
            level: 'warn',
            args: [{__error: true, message: 'boom', stack: 'STACK'}],
        });

        expect(warn).toHaveBeenCalledTimes(1);
        const [prefix, errObj] = (warn as jest.Mock).mock.calls[0];
        expect(prefix).toBe('[UI:calendar]');
        expect(errObj).toBeInstanceOf(Error);
        expect((errObj as Error).message).toBe('boom');
    });

    test('uiLog -> routes debug/info/error/default to matching logger methods', async () => {
        const {handler} = await setup();

        await handler({name: 'uiLog', level: 'debug', args: ['d']});
        await handler({name: 'uiLog', level: 'info', args: ['i']});
        await handler({name: 'uiLog', level: 'error', args: ['e']});
        await handler({name: 'uiLog', level: 'custom', args: ['x']});

        expect(dbg).toHaveBeenCalledWith('[UI]', 'd');
        expect(info).toHaveBeenCalledWith('[UI]', 'i');
        expect(err).toHaveBeenCalledWith('[UI]', 'e');
        expect(log).toHaveBeenCalledWith('[UI]', 'x');
    });

    test('requestRangeEvents -> ensures cache, expands range, posts rangeEvents', async () => {
        const {handler, postMessage, helpers} = await setup();

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 1}, {id: 2}]);
        helpers.expandAllInRange.mockReturnValue([{id: 2}]);

        await handler({name: 'requestRangeEvents', fromUtc: 10, toUtc: 20});

        expect(ensureAllEventsCache).toHaveBeenCalledWith(expect.anything());
        expect(helpers.expandAllInRange).toHaveBeenCalledWith([{id: 1}, {id: 2}], 10, 20);

        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'rangeEvents',
            events: [{id: 2}],
        });
    });

    test('requestRangeEvents -> works with wrapped message payload', async () => {
        const {handler, postMessage, helpers} = await setup();

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 1}]);
        helpers.expandAllInRange.mockReturnValue([{id: 1}]);

        await handler({message: {name: 'requestRangeEvents', fromUtc: 10, toUtc: 20}});

        expect(helpers.expandAllInRange).toHaveBeenCalledWith([{id: 1}], 10, 20);
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'rangeEvents',
            events: [{id: 1}],
        });
    });

    test('uiReady -> works with wrapped message payload', async () => {
        const {handler, joplin} = await setup();
        (pushUiSettings as jest.Mock).mockResolvedValue(undefined);

        await handler({message: {name: 'uiReady'}});

        expect(pushUiSettings).toHaveBeenCalledWith(joplin, 'panel-1');
    });

    test('requestRangeEvents -> ignores when from/to are missing (no-op)', async () => {
        const {handler, helpers, postMessage} = await setup();

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 1}]);
        (helpers.expandAllInRange as jest.Mock).mockReturnValue([{id: 1}]);

        await handler({name: 'requestRangeEvents'} as any);

        expect(helpers.expandAllInRange).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
        expect(ensureAllEventsCache).not.toHaveBeenCalled();
    });

    test('requestRangeEvents -> ignores inverted range (fromUtc > toUtc)', async () => {
        const {handler, helpers, postMessage} = await setup();

        await handler({name: 'requestRangeEvents', fromUtc: 200, toUtc: 100});

        expect(ensureAllEventsCache).not.toHaveBeenCalled();
        expect(helpers.expandAllInRange).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });
    test('dateClick -> expands day range and filters by startUtc inside [dayStart..dayEnd]', async () => {
        const {handler, postMessage, helpers} = await setup();

        const dayStart = Date.UTC(2025, 0, 10, 0, 0, 0, 0);
        const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{any: 'all'}]);

        helpers.expandAllInRange.mockReturnValue([
            {id: 'in1', startUtc: dayStart},
            {id: 'in2', startUtc: dayEnd},
            {id: 'out1', startUtc: dayStart - 1},
            {id: 'out2', startUtc: dayEnd + 1},
        ]);

        await handler({name: 'dateClick', dateUtc: dayStart});

        expect(helpers.expandAllInRange).toHaveBeenCalledWith([{any: 'all'}], dayStart, dayEnd);

        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'showEvents',
            dateUtc: dayStart,
            events: [
                {id: 'in1', startUtc: dayStart},
                {id: 'in2', startUtc: dayEnd},
            ],
        });
    });

    test('dateClick -> ignores when dateUtc is missing / invalid', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'dateClick'} as any);
        await handler({name: 'dateClick', dateUtc: 'x'} as any);

        expect(postMessage).not.toHaveBeenCalled();
        expect(ensureAllEventsCache).not.toHaveBeenCalled();
    });

    test('openNote -> executes joplin command', async () => {
        const {handler, execute} = await setup();

        await handler({name: 'openNote', id: 'note-123'});

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith('openNote', 'note-123');
    });

    test('icsImport -> missing ics posts importError and shows error toast', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'icsImport'} as any);

        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importError', error: 'Missing ICS content'});
        expect(showToast).toHaveBeenCalledWith('error', 'ICS import failed: Missing ICS content', 5000);
        expect(importIcsIntoNotes).not.toHaveBeenCalled();
        expect(invalidateAllEventsCache).not.toHaveBeenCalled();
    });

    test('openNote -> ignores when id is missing', async () => {
        const {handler, execute, postMessage} = await setup();

        await handler({name: 'openNote'});

        expect(execute).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    test('exportRangeIcs -> ignores when from/to are not numbers', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'exportRangeIcs', fromUtc: '10', toUtc: 20});

        expect(postMessage).not.toHaveBeenCalled();
    });

    test('exportRangeIcs -> ignores inverted range (fromUtc > toUtc)', async () => {
        const {handler, helpers, postMessage} = await setup();

        await handler({name: 'exportRangeIcs', fromUtc: 200, toUtc: 100});

        expect(ensureAllEventsCache).not.toHaveBeenCalled();
        expect(helpers.expandAllInRange).not.toHaveBeenCalled();
        expect(helpers.buildICS).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    test('exportRangeIcs -> builds ICS and posts rangeIcs with filename', async () => {
        const {handler, postMessage, helpers} = await setup();

        const fromUtc = Date.UTC(2025, 0, 2, 0, 0, 0, 0); // 2025-01-02
        const toUtc = Date.UTC(2025, 0, 5, 0, 0, 0, 0); // 2025-01-05

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 1}, {id: 2}]);
        helpers.expandAllInRange.mockReturnValue([{id: 1}]);
        helpers.buildICS.mockReturnValue('BEGIN:VCALENDAR...END:VCALENDAR');

        await handler({name: 'exportRangeIcs', fromUtc, toUtc});

        expect(helpers.expandAllInRange).toHaveBeenCalledWith([{id: 1}, {id: 2}], fromUtc, toUtc);
        expect(helpers.buildICS).toHaveBeenCalledWith([{id: 1}]);

        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'rangeIcs',
            ics: 'BEGIN:VCALENDAR...END:VCALENDAR',
            filename: 'mycalendar_2025-01-02_2025-01-05.ics',
        });
    });

    test('icsImport success -> posts importStatus, importDone, invalidates cache, shows toasts', async () => {
        const {handler, postMessage} = await setup();

        (importIcsIntoNotes as jest.Mock).mockImplementation(
            async (
                _joplin: any,
                _ics: string,
                sendStatus: (t: string) => Promise<void>,
                _targetFolderId?: string,
                _preserveLocalColor?: boolean,
                _importDefaultColor?: string
            ) => {
                await sendStatus('Parsing...');
                await sendStatus('Saving...');
                return {added: 1, updated: 2, skipped: 3, errors: 0, alarmsCreated: 4, alarmsDeleted: 5};
            }
        );

        await handler({
            name: 'icsImport',
            ics: 'BEGIN:VCALENDAR...',
            // targetFolderId missing -> should go undefined
            // preserveLocalColor is not set -> default true
            importDefaultColor: '#aabbcc',
        });

        // 2 statuses → 2 messages + 2 toasts info
        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importStatus', text: 'Parsing...'});
        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importStatus', text: 'Saving...'});

        expect(showToast).toHaveBeenCalledWith('info', 'Parsing...', 5000);
        expect(showToast).toHaveBeenCalledWith('info', 'Saving...', 5000);

        // invalidate cache after successful import
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);

        // importDone
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'importDone',
            added: 1,
            updated: 2,
            skipped: 3,
            errors: 0,
            alarmsCreated: 4,
            alarmsDeleted: 5,
        });

        // final toast success (because errors=0)
        expect(showToast).toHaveBeenCalledWith(
            'success',
            'ICS import finished: added=1, updated=2, skipped=3, errors=0, alarmsCreated=4, alarmsDeleted=5',
            5000
        );

        // checking arguments importIcsIntoNotes (default preserveLocalColor = true, default targetFolderId=undefined)
        const call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[1]).toBe('BEGIN:VCALENDAR...');
        expect(call[3]).toBeUndefined(); // targetFolderId
        expect(call[4]).toBe(true); // preserveLocalColor default true
        expect(call[5]).toBe('#aabbcc'); // importDefaultColor is valid
        expect(call[6]).toBe(30); // importAlarmRangeDays default
    });

    test('icsImport success -> errors>0 triggers warning toast', async () => {
        const {handler} = await setup();

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 2,
            alarmsCreated: 0,
            alarmsDeleted: 0
        });

        await handler({name: 'icsImport', ics: 'X'});

        expect(showToast).toHaveBeenCalledWith(
            'warning',
            'ICS import finished: added=0, updated=0, skipped=0, errors=2, alarmsCreated=0, alarmsDeleted=0',
            5000
        );
    });

    test('icsImport -> passes targetFolderId only when it is a string; otherwise undefined', async () => {
        const {handler} = await setup();

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            alarmsCreated: 0,
            alarmsDeleted: 0
        });

        await handler({name: 'icsImport', ics: 'X', targetFolderId: 'folder-123'});
        let call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[3]).toBe('folder-123');

        (importIcsIntoNotes as jest.Mock).mockClear();

        await handler({name: 'icsImport', ics: 'X', targetFolderId: 123});
        call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[3]).toBeUndefined();
    });

    test('icsImport -> preserveLocalColor=false is passed through', async () => {
        const {handler} = await setup();

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            alarmsCreated: 0,
            alarmsDeleted: 0
        });

        await handler({
            name: 'icsImport',
            ics: 'X',
            preserveLocalColor: false,
        });

        const call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[4]).toBe(false);
    });

    test('icsImport -> invalid importDefaultColor is ignored (undefined)', async () => {
        const {handler} = await setup();

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({
            added: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            alarmsCreated: 0,
            alarmsDeleted: 0
        });

        await handler({
            name: 'icsImport',
            ics: 'X',
            importDefaultColor: 'blue', // invalid
        });

        const call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[5]).toBeUndefined();
        expect(call[6]).toBe(30); // importAlarmRangeDays default
    });

    test('icsImport failure -> posts importError and shows error toast; does NOT invalidate cache', async () => {
        const {handler, postMessage} = await setup();

        (importIcsIntoNotes as jest.Mock).mockRejectedValue(new Error('boom'));

        await handler({name: 'icsImport', ics: 'X'});

        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importError', error: 'boom'});
        expect(showToast).toHaveBeenCalledWith('error', 'ICS import failed: boom', 5000);
        expect(invalidateAllEventsCache).not.toHaveBeenCalled();
    });

    test('icsImport failure -> supports non-Error throws (string)', async () => {
        const {handler, postMessage} = await setup();

        (importIcsIntoNotes as jest.Mock).mockRejectedValue('nope');

        await handler({name: 'icsImport', ics: 'X'});

        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importError', error: 'nope'});
        expect(showToast).toHaveBeenCalledWith('error', 'ICS import failed: nope', 5000);
    });

    test('clearEventsCache -> invalidates cache, requests redraw and shows toast', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'clearEventsCache'});

        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'redrawMonth'});
        expect(showToast).toHaveBeenCalledWith('info', 'Events cache cleared', 3000);
    });

    test('requestFolders -> paginates folders, flattens tree, sorts, and posts folders options', async () => {
        const {handler, dataGet, postMessage} = await setup();

        // page 1
        dataGet.mockResolvedValueOnce({
            items: [
                {id: 'b', title: 'B', parent_id: null},
                {id: 'a', title: 'a', parent_id: null},
                {id: 'c1', title: 'Child 1', parent_id: 'a'},
            ],
            has_more: true,
        });

        // page 2
        dataGet.mockResolvedValueOnce({
            items: [
                {id: 'c2', title: 'child 2', parent_id: 'a'},
                {id: 'bb1', title: 'bb child', parent_id: 'b'},
            ],
            has_more: false,
        });

        await handler({name: 'requestFolders'});

        // getAllFolders calls
        expect(dataGet).toHaveBeenNthCalledWith(1, ['folders'], {
            page: 1,
            limit: 100,
            fields: ['id', 'title', 'parent_id'],
        });

        expect(dataGet).toHaveBeenNthCalledWith(2, ['folders'], {
            page: 2,
            limit: 100,
            fields: ['id', 'title', 'parent_id'],
        });

        // flattenFolderTree expected order:
        // roots sorted by title case-insensitive: 'a' then 'B'
        // children of 'a' sorted: 'Child 1' then 'child 2' (localeCompare base)
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'folders',
            folders: [
                {id: 'a', title: 'a', parent_id: null, depth: 0},
                {id: 'c1', title: 'Child 1', parent_id: 'a', depth: 1},
                {id: 'c2', title: 'child 2', parent_id: 'a', depth: 1},
                {id: 'b', title: 'B', parent_id: null, depth: 0},
                {id: 'bb1', title: 'bb child', parent_id: 'b', depth: 1},
            ],
        });
    });

    test('requestFolders -> orphan / missing parent is treated as root; parent_id undefined is normalized to null', async () => {
        const {handler, dataGet, postMessage} = await setup();

        dataGet.mockResolvedValueOnce({
            items: [
                {id: 'ch', title: 'Child', parent_id: 'missing-parent'},
                {id: 'r2', title: 'B', parent_id: undefined},
                {id: 'r1', title: 'a', parent_id: null},
            ],
            has_more: false,
        });

        await handler({name: 'requestFolders'});

        // roots sorted case-insensitive: 'a', 'B', 'Child'
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'folders',
            folders: [
                {id: 'r1', title: 'a', parent_id: null, depth: 0},
                {id: 'r2', title: 'B', parent_id: null, depth: 0},
                {id: 'ch', title: 'Child', parent_id: 'missing-parent', depth: 0},
            ],
        });
    });

    test('requestFolders -> handles empty/undefined items (returns empty folders list)', async () => {
        const {handler, dataGet, postMessage} = await setup();

        dataGet.mockResolvedValueOnce({items: undefined, has_more: false});

        await handler({name: 'requestFolders'});

        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'folders', folders: []});
    });

    test('unknown msg -> no-op (no postMessage / no commands)', async () => {
        const {handler, postMessage, execute} = await setup();

        await handler({name: 'somethingElse'});

        expect(postMessage).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    test('outer try/catch -> logs error if handler body throws (e.g., ensureAllEventsCache rejects)', async () => {
        const {handler, postMessage} = await setup();


        (ensureAllEventsCache as jest.Mock).mockRejectedValue(new Error('cache fail'));

        await handler({name: 'requestRangeEvents', fromUtc: 1, toUtc: 2});

        // should not throw further, only log
        expect(err).toHaveBeenCalledWith('panelController', 'onMessage error:', expect.any(Error));
        expect(postMessage).not.toHaveBeenCalled();

    });

    test('requestRangeEvents -> forwards range to helpers and posts events', async () => {
        const {handler, helpers, postMessage} = await setup();

        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 1}]);
        (helpers.expandAllInRange as jest.Mock).mockReturnValue([{id: 1}]);

        await handler({name: 'requestRangeEvents', fromUtc: 10, toUtc: 20} as any);

        expect(helpers.expandAllInRange).toHaveBeenCalledWith([{id: 1}], 10, 20);
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'rangeEvents',
            events: [{id: 1}],
        });
    });

});
