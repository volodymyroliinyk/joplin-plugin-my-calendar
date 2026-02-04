// tests/main/pluginMain.test.ts
//
// src/main/pluginMain.ts
//
// npx jest tests/main/pluginMain.test.ts --runInBand --no-cache;
//
import runPlugin from '../../src/main/pluginMain';
import * as logger from '../../src/main/utils/logger';

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

jest.mock('../../src/main/settings/settings', () => ({
    registerSettings: jest.fn(),
}));

jest.mock('../../src/main/uiBridge/uiSettings', () => ({
    pushUiSettings: jest.fn(),
}));

import {createCalendarPanel} from '../../src/main/views/calendarView';
import {
    ensureAllEventsCache,
    invalidateNote,
} from '../../src/main/services/eventsCache';
import {registerCalendarPanelController} from '../../src/main/uiBridge/panelController';
import {pushUiSettings} from '../../src/main/uiBridge/uiSettings';
import {registerSettings} from '../../src/main/settings/settings';

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
        postMessage: jest.fn().mockResolvedValue(undefined),
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

    const toolbarButtons: any = {
        create: jest.fn().mockResolvedValue(undefined),
    };

    let onNoteChangeCb: AnyFn | null = null;
    let onSyncCompleteCb: AnyFn | null = null;

    const commandsRegister = jest.fn().mockResolvedValue(undefined);

    const joplin = {
        views: {
            panels,
            menuItems,
            toolbarButtons,
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
        settings: {
            registerSection: jest.fn().mockResolvedValue(undefined),
            registerSettings: jest.fn().mockResolvedValue(undefined),
            value: jest.fn().mockResolvedValue('monday'), // default for weekStart (or false for debug)
            onChange: jest.fn().mockResolvedValue(undefined),
            settingItemType: {
                Bool: 3,
                String: 2,
                Int: 1,
            },
        },
    };

    return {
        joplin,
        panels,
        menuItems,
        commandsRegister,
        toolbarButtons,
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
        logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
        infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(logger, 'err').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        infoSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });


    test('happy path: creates panel, registers commands, wires workspace events, registers controller and desktop toggle', async () => {
        const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
        const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([{id: 'e1'}, {id: 'e2'}]);

        const {
            joplin,
            panels,
            menuItems,
            toolbarButtons,
            commandsRegister,
            getOnNoteChange,
            getOnSyncComplete
        } = makeJoplinMock({
            withFocus: true,
            withHide: true,
            withMenu: true,
        });

        await runPlugin(joplin as any);

        expect(registerSettings).toHaveBeenCalledWith(joplin);

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
        const [, panel, helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];
        expect(panel).toBe('panel-1');
        expect(typeof helpers.expandAllInRange).toBe('function');
        expect(typeof helpers.buildICS).toBe('function');

        // panel shown once during init
        expect(panels.show).toHaveBeenCalledWith('panel-1');

        // desktop toggle registered (togglePanel command + menu item + toolbar button)
        expect(commandsRegister).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'mycalendar.togglePanel',
                label: 'Toggle My Calendar',
                iconName: 'fas fa-calendar-alt'
            })
        );
        expect(menuItems.create).toHaveBeenCalledWith(
            'mycalendarToggleMenu',
            'mycalendar.togglePanel',
            'view',
            {accelerator: 'Ctrl+Alt+C'}
        );
        expect(toolbarButtons.create).toHaveBeenCalledWith(
            'mycalendarToolbarButton',
            'mycalendar.togglePanel',
            'noteToolbar'
        );

        // init focus called if present (non-fatal if missing/throws)
        expect(panels.focus).toHaveBeenCalledWith('panel-1');

        // basic logs
        expect(logSpy).toHaveBeenCalledWith('pluginMain', 'Plugin start');
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
        const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        // focus exists but throws OR you can set withFocus:false
        const {joplin, panels, commandsRegister} = makeJoplinMock({withFocus: true, focusThrows: true});

        await runPlugin(joplin as any);

        const openCmd = findCommand(commandsRegister as any, 'mycalendar.open');
        await openCmd.execute();

        expect(panels.show).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('pluginMain', 'panels.focus not available on this platform');

        logSpy.mockRestore();
    });

    test('ensureAllEventsCache error is non-fatal and logs error', async () => {
        const errSpy = jest.spyOn(logger, 'err').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockRejectedValue(new Error('cache fail'));

        const {joplin} = makeJoplinMock();

        await runPlugin(joplin as any);

        expect(errSpy).toHaveBeenCalledWith('eventsCache', 'Error warming up cache:', expect.any(Error));

        errSpy.mockRestore();
    });

    // test('workspace.onNoteChange invalidates note (if id) and always invalidates all events', async () => {
    test('workspace.onNoteChange invalidates note (if id)', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, getOnNoteChange} = makeJoplinMock();

        await runPlugin(joplin as any);

        const cb = getOnNoteChange();
        expect(cb).toBeTruthy();

        await cb!({id: 'note-1'});
        expect(invalidateNote).toHaveBeenCalledWith('note-1');
        // expect(invalidateAllEventsCache).toHaveBeenCalledTimes(1);

        await cb!({}); // no id
        expect(invalidateNote).toHaveBeenCalledTimes(1); // still only once
        // expect(invalidateAllEventsCache).toHaveBeenCalledTimes(2);
    });

    test('desktop toggle: execute hides then shows (stateful)', async () => {
        const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, panels, commandsRegister} = makeJoplinMock({withHide: true, withMenu: true});

        await runPlugin(joplin as any);

        const toggleCmd = findCommand(commandsRegister as any, 'mycalendar.togglePanel');
        expect(toggleCmd.label).toBe('Toggle My Calendar');

        // initial state is visible=true -> first execute hides (if hide exists)
        await toggleCmd.execute();
        expect(panels.hide).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('pluginMain', 'Toggle: Hide');

        // second execute shows
        await toggleCmd.execute();
        expect(panels.show).toHaveBeenCalledWith('panel-1');
        expect(logSpy).toHaveBeenCalledWith('pluginMain', 'Toggle: Show');

        logSpy.mockRestore();
    });

    test('desktop toggle is skipped if panels.hide not available', async () => {
        const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        const {joplin, commandsRegister, menuItems, toolbarButtons} = makeJoplinMock({
            withHide: false, // hide missing
            withMenu: true,
        });

        await runPlugin(joplin as any);

        // togglePanel command IS registered now (because we register it unconditionally at start)
        // but the menu item and toolbar button should NOT be created because registerDesktopToggle checks capabilities.

        // Check that command IS registered (this changed from previous behavior)
        const toggleCall = (commandsRegister as jest.Mock).mock.calls.find(([arg]) => arg?.name === 'mycalendar.togglePanel');
        expect(toggleCall).toBeDefined();

        // menu item should not be created
        expect(menuItems.create).not.toHaveBeenCalled();

        // toolbar button should not be created
        expect(toolbarButtons.create).not.toHaveBeenCalled();

        // info about skipping
        expect(infoSpy).toHaveBeenCalledWith('pluginMain', 'Toggle: panels.show/hide not available - skip');

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

    test('helpers: yearly recurrence works properly', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);
        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);
        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        const from = Date.UTC(2023, 0, 1);
        const to = Date.UTC(2026, 0, 1);

        const ev = {
            id: 'y1',
            title: 'Yearly',
            startUtc: Date.UTC(2023, 5, 15, 10, 0, 0), // June 15
            repeat: 'yearly',
            repeatInterval: 1,
        };

        const out = helpers.expandAllInRange([ev], from, to);
        // Expect: June 15 2023, June 15 2024, June 15 2025
        expect(out.length).toBe(3);
        expect(new Date(out[0].startUtc).toISOString()).toContain('2023-06-15');
        expect(new Date(out[1].startUtc).toISOString()).toContain('2024-06-15');
        expect(new Date(out[2].startUtc).toISOString()).toContain('2025-06-15');
    });

    test('helpers: yearly on leap day (Feb 29) behavior', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);
        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);
        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        // 2024 is leap, 2025 is not
        const from = Date.UTC(2024, 0, 1);
        const to = Date.UTC(2026, 0, 1);

        const ev = {
            id: 'leap',
            title: 'Leap',
            startUtc: Date.UTC(2024, 1, 29, 10, 0, 0), // Feb 29 2024
            repeat: 'yearly',
            repeatInterval: 1,
        };

        const out = helpers.expandAllInRange([ev], from, to);
        // Should include 2024.
        // For 2025 (non-leap), Feb 29 doesn't exist.
        // The implementation logic for yearly checks `if (baseD <= daysInMonth)`.
        // baseD is 29. Feb 2025 has 28 days. 29 <= 28 is false -> Skipped.
        // So we expect ONLY 2024.
        expect(out.length).toBe(1);
        expect(new Date(out[0].startUtc).toISOString()).toContain('2024-02-29');
    });

    test('helpers: weekly recurrence preserves local time across DST boundary', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);
        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);
        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        // America/New_York
        // DST starts roughly March 10 2024 (clocks fwd 1 hour)
        // Standard UTC offset -5, DST -4.
        // Event at 10:00 AM local.
        // Before DST (Mar 3): 10:00 EST -> 15:00 UTC
        // After DST (Mar 17): 10:00 EDT -> 14:00 UTC

        const ev = {
            id: 'dst',
            title: 'DST Test',
            startUtc: Date.UTC(2024, 2, 3, 15, 0, 0), // Mar 3 2024, 15:00 UTC = 10:00 EST
            startText: '2024-03-03 10:00:00', // Needed for baseLocal parsing
            tz: 'America/New_York',
            repeat: 'weekly',
            byWeekdays: [0], // Sunday
            repeatInterval: 1,
        };

        const from = Date.UTC(2024, 2, 1); // Mar 1
        const to = Date.UTC(2024, 2, 20); // Mar 20

        const out = helpers.expandAllInRange([ev], from, to);

        // Should have Mar 3, Mar 10 (DST switch day), Mar 17
        expect(out.length).toBeGreaterThanOrEqual(3);

        const d1 = new Date(out[0].startUtc);
        const d2 = new Date(out[1].startUtc);
        const d3 = new Date(out[2].startUtc);

        // Verify UTC times shifts by 1 hour (from 15:00 to 14:00) strictly?
        // Actually on Mar 10 DST starts at 2am. 10am is already EDT (-4).
        // So Mar 3 is EST (-5) -> 15:00 UTC.
        // Mar 10 is EDT (-4) -> 14:00 UTC.
        // Mar 17 is EDT (-4) -> 14:00 UTC.

        expect(d1.getUTCHours()).toBe(15);
        expect(d2.getUTCHours()).toBe(14);
        expect(d3.getUTCHours()).toBe(14);
    });

    test('helpers: monthly recurrence on 31st skips short months', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);
        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);
        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        // Jan 31 -> expect Jan, Mar (skip Feb)
        const from = Date.UTC(2024, 0, 1);
        const to = Date.UTC(2024, 3, 1); // Up to April 1

        const ev = {
            id: 'm31',
            title: 'Monthly31',
            startUtc: Date.UTC(2024, 0, 31, 10, 0, 0),
            repeat: 'monthly',
            repeatInterval: 1,
            byMonthDay: 31,
        };

        const out = helpers.expandAllInRange([ev], from, to);
        // Should have Jan 31 and Mar 31. Feb 31 doesn't exist.
        expect(out.length).toBe(2);
        expect(new Date(out[0].startUtc).toISOString()).toContain('2024-01-31');
        expect(new Date(out[1].startUtc).toISOString()).toContain('2024-03-31');
    });

    test('helpers: expandAllInRange correctly handles event duration spanning days', async () => {
        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);
        const {joplin} = makeJoplinMock();
        await runPlugin(joplin as any);
        const [, , helpers] = (registerCalendarPanelController as jest.Mock).mock.calls[0];

        // Event from Jan 1 23:00 to Jan 2 01:00
        const start = Date.UTC(2025, 0, 1, 23, 0, 0);
        const end = Date.UTC(2025, 0, 2, 1, 0, 0);

        const ev = {
            id: 'dur1',
            title: 'Overnight',
            startUtc: start,
            endUtc: end,
            repeat: 'daily',
            repeatInterval: 1,
        };

        const from = Date.UTC(2025, 0, 1, 0, 0, 0);
        const to = Date.UTC(2025, 0, 5, 0, 0, 0);

        const out = helpers.expandAllInRange([ev], from, to);

        // Jan 1, 2, 3, 4
        expect(out.length).toBe(4);
        expect(out[0].startUtc).toBe(start);
        expect(out[0].endUtc).toBe(end);
        expect(out[1].startUtc).toBe(start + 24 * 3600 * 1000);
        expect(out[1].endUtc).toBe(end + 24 * 3600 * 1000);
    });

    test('uiLog from panel -> routes to logger (unwraps {message: ...})', async () => {
        const logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

        const ctx = makeJoplinMock();
        let uiHandler: any = null;

        // enable registerUiMessageHandlers path
        (ctx.panels as any).onMessage = jest.fn(async (_panelId: string, cb: any) => {
            uiHandler = cb;
        });

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');

        await runPlugin(ctx.joplin as any);

        expect(typeof uiHandler).toBe('function');

        await uiHandler({
            message: {
                name: 'uiLog',
                level: 'warn',
                source: 'calendar',
                args: ['hello'],
            },
        });

        expect(warnSpy).toHaveBeenCalledWith('[UI:calendar]', 'hello');
        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    test('uiReady from panel -> pushes UI settings and triggers redraw', async () => {
        const ctx = makeJoplinMock();
        let uiHandler: any = null;

        // enable registerUiMessageHandlers path
        (ctx.panels as any).onMessage = jest.fn(async (_panelId: string, cb: any) => {
            uiHandler = cb;
        });

        (createCalendarPanel as jest.Mock).mockResolvedValue('panel-1');
        (ensureAllEventsCache as jest.Mock).mockResolvedValue([]);

        await runPlugin(ctx.joplin as any);

        expect(typeof uiHandler).toBe('function');

        await uiHandler({name: 'uiReady'});

        expect(pushUiSettings).toHaveBeenCalledWith(ctx.joplin, 'panel-1');
        expect(ctx.panels.postMessage).not.toHaveBeenCalled();
    });
});
