// tests/uiBridge/panelController.test.ts
// src/main/uiBridge/panelController.ts
//
// npx jest tests/uiBridge/panelController.test.ts --runInBand --no-cache;
//

import {registerCalendarPanelController} from '../../src/main/uiBridge/panelController';

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

import {ensureAllEventsCache, invalidateAllEventsCache} from '../../src/main/services/eventsCache';
import {importIcsIntoNotes} from '../../src/main/services/icsImportService';
import {showToast} from '../../src/main/utils/toast';

type AnyFn = (...args: any[]) => any;

function makeJoplinMock() {
    const onMessage = jest.fn();
    const postMessage = jest.fn();
    const dataGet = jest.fn();
    const execute = jest.fn();

    const joplin = {
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
        expandAllInRange: jest.fn((events: any[], fromUtc: number, toUtc: number) => events),
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

    return {joplin, helpers, handler, onMessage, postMessage, dataGet, execute};
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('panelController', () => {
    test('uiReady -> posts uiAck', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'uiReady'});

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'uiAck'});
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

    test('openNote -> executes joplin command', async () => {
        const {handler, execute} = await setup();

        await handler({name: 'openNote', id: 'note-123'});

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith('openNote', 'note-123');
    });

    test('exportRangeIcs -> ignores when from/to are not numbers', async () => {
        const {handler, postMessage} = await setup();

        await handler({name: 'exportRangeIcs', fromUtc: '10', toUtc: 20});

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
                return {added: 1, updated: 2, skipped: 3, errors: 0};
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

        expect(showToast).toHaveBeenCalledWith('info', 'Parsing...', 2000);
        expect(showToast).toHaveBeenCalledWith('info', 'Saving...', 2000);

        // invalidate cache after successful import
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);

        // importDone
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'importDone',
            added: 1,
            updated: 2,
            skipped: 3,
            errors: 0,
        });

        // final toast success (because errors=0)
        expect(showToast).toHaveBeenCalledWith(
            'success',
            'ICS import finished: added=1, updated=2, skipped=3, errors=0',
            4000
        );

        // checking arguments importIcsIntoNotes (default preserveLocalColor = true, default targetFolderId=undefined)
        const call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[1]).toBe('BEGIN:VCALENDAR...');
        expect(call[3]).toBeUndefined(); // targetFolderId
        expect(call[4]).toBe(true); // preserveLocalColor default true
        expect(call[5]).toBe('#aabbcc'); // importDefaultColor is valid
    });

    test('icsImport -> preserveLocalColor=false is passed through', async () => {
        const {handler} = await setup();

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({added: 0, updated: 0, skipped: 0, errors: 0});

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

        (importIcsIntoNotes as jest.Mock).mockResolvedValue({added: 0, updated: 0, skipped: 0, errors: 0});

        await handler({
            name: 'icsImport',
            ics: 'X',
            importDefaultColor: 'blue', // invalid
        });

        const call = (importIcsIntoNotes as jest.Mock).mock.calls[0];
        expect(call[5]).toBeUndefined();
    });

    test('icsImport failure -> posts importError and shows error toast; does NOT invalidate cache', async () => {
        const {handler, postMessage} = await setup();

        (importIcsIntoNotes as jest.Mock).mockRejectedValue(new Error('boom'));

        await handler({name: 'icsImport', ics: 'X'});

        expect(postMessage).toHaveBeenCalledWith('panel-1', {name: 'importError', error: 'boom'});
        expect(showToast).toHaveBeenCalledWith('error', 'ICS import failed: boom', 5000);
        expect(invalidateAllEventsCache).not.toHaveBeenCalled();
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

    test('unknown msg -> no-op (no postMessage / no commands)', async () => {
        const {handler, postMessage, execute} = await setup();

        await handler({name: 'somethingElse'});

        expect(postMessage).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    test('outer try/catch -> logs error if handler body throws (e.g., ensureAllEventsCache rejects)', async () => {
        const {handler, postMessage} = await setup();

        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        (ensureAllEventsCache as jest.Mock).mockRejectedValue(new Error('cache fail'));

        await handler({name: 'requestRangeEvents', fromUtc: 1, toUtc: 2});

        // should not throw further, only log
        expect(spy).toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();

        spy.mockRestore();
    });
});
