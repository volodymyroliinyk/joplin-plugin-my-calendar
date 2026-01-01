// tests/main/pluginMain.test.ts
// src/main/pluginMain.ts

import runPlugin from '../../src/main/pluginMain';

jest.mock('../../src/main/views/calendarView', () => ({
    createCalendarPanel: jest.fn(),
}));

jest.mock('../../src/main/services/eventsCache', () => ({
    ensureAllEventsCache: jest.fn(),
    invalidateNote: jest.fn(),
    invalidateAllEventsCache: jest.fn(),
}));

jest.mock('../../src/main/uiBridge/panelController', () => ({
    registerCalendarPanelController: jest.fn(),
}));

import {createCalendarPanel} from '../../src/main/views/calendarView';
import {
    ensureAllEventsCache,
    invalidateNote,
    invalidateAllEventsCache,
} from '../../src/main/services/eventsCache';
import {registerCalendarPanelController} from '../../src/main/uiBridge/panelController';

type AnyFn = (...a: any[]) => any;

function makeJoplinMock(opts?: {
    withFocus?: boolean;
    focusThrows?: boolean;
    withHide?: boolean;
    withMenu?: boolean;
}) {
    const withFocus = opts?.withFocus ?? true;
    const focusThrows = opts?.focusThrows ?? false;
    const withHide = opts?.withHide ?? true;
    const withMenu = opts?.withMenu ?? true;

    const panels: any = {
        show: jest.fn().mockResolvedValue(undefined),
    };

    if (withHide) {
        panels.hide = jest.fn().mockResolvedValue(undefined);
    }

    if (withFocus) {
        panels.focus = jest.fn(async () => {
            if (focusThrows) throw new Error('focus failed');
            return undefined;
        });
    }

    const menuItems: any = {};
    if (withMenu) {
        menuItems.create = jest.fn().mockResolvedValue(undefined);
    }

    let onNoteChangeCb: AnyFn | null = null;
    let onSyncCompleteCb: AnyFn | null = null;

    const commandsRegister = jest.fn().mockResolvedValue(undefined);

    const joplin = {
        views: {
            panels,
            menuItems,
        },
        commands: {
            register: commandsRegister,
        },
        workspace: {
            onNoteChange: jest.fn(async (cb: AnyFn) => {
                onNoteChangeCb = cb;
            }),
            onSyncComplete: jest.fn(async (cb: AnyFn) => {
                onSyncCompleteCb = cb;
            }),
        },
    };

    return {
        joplin,
        panels,
        menuItems,
        commandsRegister,
        getOnNoteChange: () => onNoteChangeCb,
        getOnSyncComplete: () => onSyncCompleteCb
    };
}

function findCommand(commandsRegister: jest.Mock, name: string) {
    const call = commandsRegister.mock.calls.find(([arg]) => arg?.name === name);
    if (!call) throw new Error(`Command not registered: ${name}`);
    return call[0];
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('pluginMain.runPlugin', () => {

    let logSpy: jest.SpyInstance;
    let infoSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        infoSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });


    test('happy path: creates panel, registers commands, wires workspace events, registers controller and desktop toggle', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 'e1'}, {id: 'e2'}]);

        const {joplin, panels, menuItems, commandsRegister, getOnNoteChange, getOnSyncComplete} = makeJoplinMock({
            withFocus: true,
            withHide: true,
            withMenu: true,
        });

        await runPlugin(joplin as any);

        // createCalendarPanel called
        expect(createCalendarPanel).toHaveBeenCalledWith(joplin);

        // open command registered
        expect(commandsRegister).toHaveBeenCalledWith(
            expect.objectContaining({name: 'mycalendar.open', label: 'Open MyCalendar'})
        );

        // ensure cache called but non-fatal on error (tested separately)
        expect(ensureAllEventsCache).toHaveBeenCalledWith(joplin);

        // workspace listeners registered
        expect(joplin.workspace.onNoteChange).toHaveBeenCalledTimes(1);
        expect(joplin.workspace.onSyncComplete).toHaveBeenCalledTimes(1);
        expect(typeof getOnNoteChange()).toBe('function');
        expect(typeof getOnSyncComplete()).toBe('function');

        // controller registered with helpers
        expect(registerCalendarPanelController).toHaveBeenCalledTimes(1);
        const [, panelId, helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];
        expect(panelId).toBe('panel-1');
        expect(typeof helpers.expandAllInRange).toBe('function');
        expect(typeof helpers.buildICS).toBe('function');

        // panel shown once during init
        expect(panels.show).toHaveBeenCalledWith('panel-1');

        // desktop toggle registered (togglePanel command + menu item)
        expect(commandsRegister).toHaveBeenCalledWith(
            expect.objectContaining({name: 'mycalendar.togglePanel', label: 'Toggle MyCalendar panel'})
        );
        expect(menuItems.create).toHaveBeenCalledWith('mycalendarToggleMenu', 'mycalendar.togglePanel', 'view');

        // init focus called if present (non-fatal if missing/throws)
        expect(panels.focus).toHaveBeenCalledWith('panel-1');

        // basic logs
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar] pluginMain: start');
        expect(infoSpy).toHaveBeenCalled(); // capabilities info

        logSpy.mockRestore();
        infoSpy.mockRestore();
    });

    test('open command execute: shows panel and focuses when focus exists', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, panels, commandsRegister} = makeJoplinMock({withFocus: true});

        await runPlugin(joplin as any);

        const openCmd = findCommand(commandsRegister as any, 'mycalendar.open');
        await openCmd.execute();

        expect(panels.show).toHaveBeenCalledWith('panel-1');
        expect(panels.focus).toHaveBeenCalledWith('panel-1');
    });

    test('open command execute: does not crash when focus missing/throws, logs message', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        // focus exists but throws OR you can set withFocus:false
        const {joplin, panels, commandsRegister} = makeJoplinMock({withFocus: true, focusThrows: true});

        await runPlugin(joplin as any);

        const openCmd = findCommand(commandsRegister as any, 'mycalendar.open');
        await openCmd.execute();

        expect(panels.show).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar] panels.focus not available on this platform');

        logSpy.mockRestore();
    });

    test('ensureAllEventsCache error is non-fatal and logs error', async () => {
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockRejectedValue(new Error('cache fail'));

        const {joplin} = makeJoplinMock();

        await runPlugin(joplin as any);

        expect(errSpy).toHaveBeenCalledWith('[MyCalendar] ensureAllEventsCache error:', expect.any(Error));

        errSpy.mockRestore();
    });

    test('workspace.onNoteChange invalidates note (if id) and always invalidates all events', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, getOnNoteChange} = makeJoplinMock();

        await runPlugin(joplin as any);

        const cb = getOnNoteChange();
        expect(cb).toBeTruthy();

        await cb!({id: 'note-1'});
        expect(invalidateNote).toHaveBeenCalledWith('note-1');
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);

        await cb!({}); // no id
        expect(invalidateNote).toHaveBeenCalledTimes(1); // still only once
        expect(invalidateAllEventsCache).toHaveBeenCalledTimes(2);
    });

    test('desktop toggle: execute hides then shows (stateful)', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, panels, commandsRegister} = makeJoplinMock({withHide: true, withMenu: true});

        await runPlugin(joplin as any);

        const toggleCmd = findCommand(commandsRegister as any, 'mycalendar.togglePanel');

        // initial state is visible=true -> first execute hides (if hide exists)
        await toggleCmd.execute();
        expect(panels.hide).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar] toggle Hide');

        // second execute shows
        await toggleCmd.execute();
        expect(panels.show).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar] toggle Show');

        logSpy.mockRestore();
    });

    test('desktop toggle is skipped if panels.hide not available', async () => {
        const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, commandsRegister, menuItems} = makeJoplinMock({
            withHide: false, // hide missing
            withMenu: true,
        });

        await runPlugin(joplin as any);

        // togglePanel command should NOT be registered
        const toggleCall = (commandsRegister as jest.Mock).mock.calls.find(([arg]) => arg?.name === 'mycalendar.togglePanel');
        expect(toggleCall).toBeUndefined();

        // menu item should not be created
        expect(menuItems.create).not.toHaveBeenCalled();

        // info about skipping
        expect(infoSpy).toHaveBeenCalledWith('[MyCalendar] toggle: panels.show/hide not available - skip');

        infoSpy.mockRestore();
    });

    test('helpers: buildICS escapes special chars and includes optional fields', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);

        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

        const ics = helpers.buildICS([
            {
                id: 'id1',
                occurrenceId: 'id1#123',
                startUtc: Date.UTC(2025, 0, 2, 10, 0, 0),
                endUtc: Date.UTC(2025, 0, 2, 11, 0, 0),
                title: 'Hello,;\\\nWorld',
                location: 'Loc,;\\',
                description: 'Line1\nLine2',
                color: '#aabbcc',
            },
        ]);

        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('BEGIN:VEVENT');
        expect(ics).toContain('UID:id1#123'); // occurrenceId used
        expect(ics).toContain('DTSTART:20250102T100000Z');
        expect(ics).toContain('DTEND:20250102T110000Z');

        // escaping rules: \ => \\ ; => \; , => \, \n => \n
        expect(ics).toContain('SUMMARY:Hello\\,\\;\\\\\\nWorld');
        expect(ics).toContain('LOCATION:Loc\\,\\;\\\\');
        expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
        expect(ics).toContain('X-COLOR:#aabbcc');

        expect(ics).toContain('END:VEVENT');
        expect(ics).toContain('END:VCALENDAR');

        nowSpy.mockRestore();
    });

    test('helpers: expandAllInRange supports repeat=none and repeat=daily', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);

        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        const from = Date.UTC(2025, 0, 1, 0, 0, 0);
        const to = Date.UTC(2025, 0, 5, 0, 0, 0);

        // non-recurring inside range
        const evNone = {
            id: 'n1',
            title: 'One',
            startUtc: Date.UTC(2025, 0, 2, 10, 0, 0),
            endUtc: Date.UTC(2025, 0, 2, 11, 0, 0),
            repeat: 'none',
        };

        // daily recurring
        const evDaily = {
            id: 'd1',
            title: 'Daily',
            startUtc: Date.UTC(2025, 0, 1, 9, 0, 0),
            endUtc: Date.UTC(2025, 0, 1, 10, 0, 0),
            repeat: 'daily',
            repeatInterval: 1,
            repeatUntilUtc: Date.UTC(2025, 0, 3, 23, 59, 59),
        };

        const out = helpers.expandAllInRange([evNone, evDaily], from, to);

        // at least: 1 occurrence for non-recurring + 3 daily (Jan1, Jan2, Jan3)
        const ids = out.map((x: any) => x.id);
        expect(ids.filter((x: string) => x === 'n1').length).toBe(1);
        expect(ids.filter((x: string) => x === 'd1').length).toBeGreaterThanOrEqual(3);

        // sorted by startUtc
        for (let i = 1; i < out.length; i++) {
            expect(out[i].startUtc).toBeGreaterThanOrEqual(out[i - 1].startUtc);
        }
    });

    test('helpers: weekly recurring without tz returns empty (safe behavior)', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);

        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        const from = Date.UTC(2025, 0, 1, 0, 0, 0);
        const to = Date.UTC(2025, 0, 10, 0, 0, 0);

        const evWeeklyNoTz = {
            id: 'w1',
            title: 'Weekly',
            startUtc: Date.UTC(2025, 0, 1, 9, 0, 0),
            startText: '2025-01-01 09:00:00',
            repeat: 'weekly',
            repeatInterval: 1,
            byWeekdays: [0], // Monday (Mon=0)
            // tz missing
        };

        const out = helpers.expandAllInRange([evWeeklyNoTz], from, to);
        expect(out).toEqual([]);
    });

    test('helpers: monthly with byMonthDay invalid for month is skipped', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);

        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        const from = Date.UTC(2025, 1, 1, 0, 0, 0);  // Feb 1
        const to = Date.UTC(2025, 1, 28, 23, 59, 59);

        const evMonthly31 = {
            id: 'm1',
            title: 'Monthly31',
            startUtc: Date.UTC(2025, 0, 31, 9, 0, 0),  // Jan 31
            repeat: 'monthly',
            repeatInterval: 1,
            byMonthDay: 31, // Feb has no 31
            repeatUntilUtc: Date.UTC(2025, 1, 28, 23, 59, 59),
        };

        const out = helpers.expandAllInRange([evMonthly31], from, to);

        // Feb occurrences should be skipped because day 31 doesn't exist
        expect(out).toEqual([]);
    });
});
