// tests/main/weekStartFlow.test.ts
//
// src/main/pluginMain.ts
//
// TZ=UTC npx jest tests/main/weekStartFlow.test.ts --runInBand --no-cache;
//
// Backend-focused tests for weekStart propagation.
// NOTE: mocks ensureAllEventsCache returns [] to avoid noisy console errors.
//
import runPlugin from '../../src/main/pluginMain';

jest.mock('../../src/main/views/calendarView', () => ({
    createCalendarPanel: jest.fn(),
}));

jest.mock('../../src/main/services/eventsCache', () => ({
    ensureAllEventsCache: jest.fn().mockResolvedValue([]),
    invalidateNote: jest.fn().mockResolvedValue(undefined),
    invalidateAllEventsCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/main/uiBridge/panelController', () => ({
    registerCalendarPanelController: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/main/settings/settings', () => ({
    registerSettings: jest.fn().mockResolvedValue(undefined),
    getWeekStart: jest.fn(),
    getDebugEnabled: jest.fn().mockResolvedValue(false),
    getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(1),
    getShowEventTimeline: jest.fn().mockResolvedValue(true),
    getShowWeekNumbers: jest.fn().mockResolvedValue(false),
}));

import {createCalendarPanel} from '../../src/main/views/calendarView';
import {getWeekStart} from '../../src/main/settings/settings';

type AnyFn = (...args: any[]) => any;

function makeJoplinMock() {
    let onChangeCb: AnyFn | null = null;

    const postMessage = jest.fn().mockResolvedValue(undefined);

    const joplin: any = {
        views: {
            panels: {
                postMessage,
                show: jest.fn().mockResolvedValue(undefined),
                hide: jest.fn().mockResolvedValue(undefined),
                visible: jest.fn().mockResolvedValue(true),
                focus: jest.fn().mockResolvedValue(undefined),
                onMessage: jest.fn().mockResolvedValue(undefined),
            },
        },
        commands: {
            register: jest.fn().mockResolvedValue(undefined),
        },
        workspace: {
            onNoteChange: jest.fn().mockResolvedValue(undefined),
            onSyncComplete: jest.fn().mockResolvedValue(undefined),
        },
        settings: {
            registerSection: jest.fn().mockResolvedValue(undefined),
            registerSettings: jest.fn().mockResolvedValue(undefined),
            value: jest.fn().mockResolvedValue('monday'),
            onChange: jest.fn(async (cb: AnyFn) => {
                onChangeCb = cb;
            }),
            settingItemType: {Bool: 3, String: 2, Int: 1},
        },
        data: {
            get: jest.fn(),
            put: jest.fn(),
            post: jest.fn(),
            delete: jest.fn(),
        },
    };

    return {
        joplin,
        getOnChange: () => onChangeCb,
        postMessage,
    };
}

describe('weekStart flow (backend)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('pushes uiSettings on startup (initial weekStart)', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (getWeekStart as jest.Mock).mockResolvedValue('monday');

        const {joplin, postMessage} = makeJoplinMock();
        await runPlugin(joplin);

        expect(postMessage).toHaveBeenCalledWith(
            'panel-1',
            expect.objectContaining({name: 'uiSettings', weekStart: 'monday', dayEventsRefreshMinutes: 1,})
        );
    });

    test('settings.onChange: multiple toggles must post uiSettings every time with current value', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');

        let weekStart: 'monday' | 'sunday' = 'monday';
        (getWeekStart as jest.Mock).mockImplementation(async () => weekStart);

        const {joplin, postMessage, getOnChange} = makeJoplinMock();
        await runPlugin(joplin);

        const cb = getOnChange();
        expect(typeof cb).toBe('function');

        weekStart = 'sunday';
        await cb!();
        expect(postMessage).toHaveBeenCalledWith(
            'panel-1',
            expect.objectContaining({name: 'uiSettings', weekStart: 'sunday'})
        );

        weekStart = 'monday';
        await cb!();
        expect(postMessage).toHaveBeenCalledWith(
            'panel-1',
            expect.objectContaining({name: 'uiSettings', weekStart: 'monday'})
        );

        const uiSettingsCalls = postMessage.mock.calls.filter(([, msg]) => msg?.name === 'uiSettings');
        expect(uiSettingsCalls.length).toBeGreaterThanOrEqual(3);
    });
});
