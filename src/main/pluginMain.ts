// src/main/pluginMain.ts

import {createCalendarPanel} from './views/calendarView';

import {ensureAllEventsCache, invalidateAllEventsCache, refreshNoteCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';
import {SCHEDULED_ICS_IMPORT_SETTING_KEYS, registerSettings, SETTING_PANEL_VISIBLE} from './settings/settings';
import {pushUiSettings} from "./uiBridge/uiSettings";
import {expandAllInRange} from './services/occurrenceService';
import {Joplin} from './types/joplin.interface';
import {startScheduledIcsImport} from './services/scheduledIcsImportService';
import {buildCalendarIcs} from './services/icsExportService';

import {err, info, log, warn} from './utils/logger';

let pluginStartPromise: Promise<void> | null = null;
const TOGGLE_COMMAND_LABEL = 'Toggle My Calendar';
const TOGGLE_COMMAND_CANDIDATES = ['mycalendar.togglePanel', 'mycalendar.togglePanelV2'] as const;
const TOGGLE_MENU_TARGETS = [
    {id: 'mycalendarToggleMenuView', location: 'view'},
    {id: 'mycalendarToggleMenuTools', location: 'tools'},
] as const;
const TOGGLE_TOOLBAR_TARGETS = [
    {id: 'mycalendarToolbarButtonNote', location: 'noteToolbar'},
    {id: 'mycalendarToolbarButtonEditor', location: 'editorToolbar'},
] as const;

type ToggleState = {
    visible: boolean;
    active?: boolean;
};

async function safePostMessage(joplin: Joplin, panelId: string, message: unknown): Promise<void> {
    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm === 'function') await pm(panelId, message);
}

async function postRedrawMonth(joplin: Joplin, panelId: string): Promise<void> {
    await safePostMessage(joplin, panelId, {name: 'redrawMonth'});
}

async function pushUiSettingsSafely(joplin: Joplin, panelId: string, context: string): Promise<void> {
    try {
        await pushUiSettings(joplin, panelId);
    } catch (error) {
        warn('pluginMain', `${context} (non-fatal):`, error);
    }
}

async function focusPanelIfSupported(joplin: Joplin, panelId: string): Promise<void> {
    try {
        const focus = joplin?.views?.panels?.focus;
        if (typeof focus === 'function') {
            await focus(panelId);
        }
    } catch {
        // On mobile this method may be missing - it's expected.
        log('pluginMain', 'panels.focus not available on this platform');
    }
}

async function persistPanelVisibleSetting(joplin: Joplin, visible: boolean): Promise<void> {
    try {
        const setValue = joplin?.settings?.setValue;
        if (typeof setValue === 'function') {
            await setValue(SETTING_PANEL_VISIBLE, visible);
        }
    } catch (error) {
        warn('pluginMain', 'Failed to persist panel visibility (non-fatal):', error);
    }
}

async function getPanelVisibleIfSupported(joplin: Joplin, panelId: string): Promise<boolean | undefined> {
    try {
        const visible = joplin?.views?.panels?.visible;
        if (typeof visible !== 'function') return undefined;
        const v = await visible(panelId);
        return typeof v === 'boolean' ? v : undefined;
    } catch (error) {
        warn('pluginMain', 'Failed to read panel visibility via API (non-fatal):', error);
        return undefined;
    }
}


async function startPlugin(joplin: Joplin): Promise<void> {
    log('pluginMain', 'Plugin start');

    await registerSettings(joplin);

    const panel = await createCalendarPanel(joplin);
    log('pluginMain', 'Panel created:', panel);

    const scheduledIcsImport = await startScheduledIcsImport(joplin, {
        onAfterImport: async () => {
            await postRedrawMonth(joplin, panel);
        },
    });

    await registerCalendarPanelController(joplin, panel, {
        expandAllInRange,
        buildICS: buildCalendarIcs,
        runScheduledIcsImport: scheduledIcsImport.runNow,
    });

    // warm up the cache after the UI already has handlers
    void (async () => {
        try {
            const all = await ensureAllEventsCache(joplin);
            log('eventsCache', 'Events cached:', all.length);
        } catch (error) {
            err('eventsCache', 'Error warming up cache:', error);
        }
    })();

    let initialPanelVisible: boolean | undefined;
    try {
        const v = await joplin?.settings?.value?.(SETTING_PANEL_VISIBLE);
        if (typeof v === 'boolean') initialPanelVisible = v;
    } catch (error) {
        warn('pluginMain', 'Failed to read persisted panel visibility (non-fatal):', error);
    }

    const toggleState = {
        // Important: this must reflect the last user-visible state, otherwise the
        // first menu toggle after restart can become a no-op (trying to hide an
        // already-hidden panel).
        visible: initialPanelVisible ?? true,
        // Indicates whether desktop menu/toolbar were registered successfully.
        active: false,
    };

    // Best-effort sync with the real panel state (Joplin may restore layout/visibility itself).
    const actualVisible = await getPanelVisibleIfSupported(joplin, panel);
    if (typeof actualVisible === 'boolean') {
        toggleState.visible = actualVisible;
    }

    let toggleCommandName = '';
    let toggleCommandError: string | undefined;
    try {
        toggleCommandName = await registerToggleCommand(joplin, panel, toggleState);
    } catch (e) {
        toggleCommandError = String(e);
        warn('pluginMain', 'Toggle command registration failed (non-fatal):', e);
    }

    await registerDesktopToggle(joplin, panel, toggleState, toggleCommandName, toggleCommandError);

    await joplin.commands.register({
        name: 'mycalendar.open',
        label: 'Open MyCalendar',
        execute: async () => {
            await joplin.views.panels.show(panel);
            // Ensure the UI gets the latest weekStart when the panel becomes visible.
            await pushUiSettingsSafely(joplin, panel, 'pushUiSettings failed in open command');
            try {
                await postRedrawMonth(joplin, panel);
            } catch (_err) {
                // ignore
            }
            await focusPanelIfSupported(joplin, panel);

            // Sync toggle state
            toggleState.visible = true;
            await persistPanelVisibleSetting(joplin, true);
            // await toggleState.update();
        },
    });

    await joplin.workspace?.onNoteChange?.(async ({id}: { id?: string }) => {
        if (id) await refreshNoteCache(joplin, id);
    });

    await joplin.workspace?.onSyncComplete?.(async () => {
        invalidateAllEventsCache();
    });

    await pushUiSettingsSafely(joplin, panel, 'Initial pushUiSettings failed');

    // await joplin.views.panels.show(panel);

    const onSettingsChange = joplin?.settings?.onChange;
    if (typeof onSettingsChange === 'function') {
        try {
            await onSettingsChange(async (event?: { keys?: string[] }) => {
                await pushUiSettingsSafely(joplin, panel, 'pushUiSettings failed after settings change');
                const keys = Array.isArray(event?.keys) ? event.keys : [];
                if (!keys.some((key) => SCHEDULED_ICS_IMPORT_SETTING_KEYS.includes(key as typeof SCHEDULED_ICS_IMPORT_SETTING_KEYS[number]))) {
                    return;
                }
                await scheduledIcsImport.refresh();
            });
        } catch (e) {
            warn('pluginMain', 'settings.onChange registration failed (non-fatal):', e);
        }
    } else {
        info('pluginMain', 'settings.onChange not available - skip');
    }

    await pushUiSettingsSafely(joplin, panel, 'pushUiSettings after toggle setup failed');

    // --- Create the import panel (desktop)

    await focusPanelIfSupported(joplin, panel);
}

export function __resetPluginMainForTests(): void {
    pluginStartPromise = null;
}

export default async function runPlugin(joplin: Joplin): Promise<void> {
    if (pluginStartPromise) {
        log('pluginMain', 'Plugin already started - skip re-init');
        await pluginStartPromise;
        return;
    }

    pluginStartPromise = startPlugin(joplin);

    try {
        await pluginStartPromise;
    } catch (error) {
        pluginStartPromise = null;
        throw error;
    }
}

// Register the toggle command once. The label is intentionally static because
// dynamic label updates are not reliably supported by Joplin's menu API.
async function registerToggleCommand(joplin: Joplin, panel: string, toggleState: ToggleState): Promise<string> {
    const execute = async () => {
        // Always toggle based on the *real* panel state if supported. Otherwise, fall back
        // to our last known state (persisted between sessions).
        const actualVisible = await getPanelVisibleIfSupported(joplin, panel);
        if (typeof actualVisible === 'boolean') toggleState.visible = actualVisible;

        const nextVisible = !toggleState.visible;
        if (nextVisible) {
            await joplin.views.panels.show(panel);
            toggleState.visible = true;
            await persistPanelVisibleSetting(joplin, true);
            log('pluginMain', 'Toggle: Show');
        } else {
            const hide = joplin.views?.panels?.hide;
            if (typeof hide === 'function') {
                await hide(panel);
                toggleState.visible = false;
                await persistPanelVisibleSetting(joplin, false);
                log('pluginMain', 'Toggle: Hide');
                return;
            }

            // Fallback for Joplin builds where `panels.hide` is not exposed.
            const show = joplin.views?.panels?.show as ((panelId: string, visible?: boolean) => Promise<void>) | undefined;
            if (typeof show === 'function') {
                try {
                    await show(panel, false);
                    toggleState.visible = false;
                    await persistPanelVisibleSetting(joplin, false);
                    log('pluginMain', 'Toggle: Hide');
                    return;
                } catch {
                    // keep previous state when hide attempt fails
                    toggleState.visible = true;
                }
            }

            info('pluginMain', 'Toggle: hide not available - panel remains visible');
        }
    };

    const registerByName = async (name: string): Promise<boolean> => {
        const commandWithIcon = {
            name,
            label: TOGGLE_COMMAND_LABEL,
            iconName: 'fas fa-calendar-alt',
            execute,
        };

        try {
            await joplin.commands.register(commandWithIcon);
            return true;
        } catch (e) {
            warn('pluginMain', `Toggle command register with icon failed for "${name}", retrying without icon:`, e);
        }

        try {
            await joplin.commands.register({
                name,
                label: TOGGLE_COMMAND_LABEL,
                execute,
            });
            return true;
        } catch (e) {
            warn('pluginMain', `Toggle command register without icon failed for "${name}":`, e);
            return false;
        }
    };

    for (const name of TOGGLE_COMMAND_CANDIDATES) {
        if (await registerByName(name)) {
            return name;
        }
    }

    throw new Error('Failed to register toggle command');
}

// === MyCalendar: safe desktop toggle helper ===
async function registerDesktopToggle(
    joplin: Joplin,
    panel: string,
    toggleState: ToggleState,
    toggleCommandName: string,
    toggleCommandError?: string,
) {
    try {
        const canShow = !!joplin?.views?.panels?.show;
        const canMenu = !!joplin?.views?.menuItems?.create;
        const canToolbar = !!joplin?.views?.toolbarButtons?.create;

        info('pluginMain', 'Toggle capabilities:', {canShow, canMenu, canToolbar, panel, toggleCommandName});

        if (!canShow) {
            info('pluginMain', 'Toggle: panels.show not available - skip');
            return;
        }
        if (!toggleCommandName) {
            warn('pluginMain', 'Toggle command is missing - skip menu/toolbar registration', toggleCommandError);
            return;
        }

        toggleState.active = true;
        // Initial update to ensure label is correct
        // (no-op) label is intentionally static

        const menuCreate = joplin.views?.menuItems?.create;
        if (typeof menuCreate === 'function') {
            let menuRegisteredCount = 0;
            for (const target of TOGGLE_MENU_TARGETS) {
                try {
                    await menuCreate(
                        target.id,
                        toggleCommandName,
                        target.location,
                        {accelerator: 'Ctrl+Alt+C'}
                    );
                    menuRegisteredCount += 1;
                    log('pluginMain', `Toggle menu item registered at "${target.location}"`);
                } catch (e) {
                    warn('pluginMain', `Menu create failed for location "${target.location}" (non-fatal):`, e);
                }
            }
            if (menuRegisteredCount === 0) {
                warn('pluginMain', 'Menu create failed for all known locations (non-fatal)');
            }
        }

        const toolbarCreate = joplin.views?.toolbarButtons?.create;
        if (typeof toolbarCreate === 'function') {
            let toolbarRegisteredCount = 0;
            for (const target of TOGGLE_TOOLBAR_TARGETS) {
                try {
                    await toolbarCreate(
                        target.id,
                        toggleCommandName,
                        target.location
                    );
                    toolbarRegisteredCount += 1;
                    log('pluginMain', `Toolbar button registered at "${target.location}"`);
                } catch (e) {
                    warn('pluginMain', `Toolbar button create failed for location "${target.location}" (non-fatal):`, e);
                }
            }
            if (toolbarRegisteredCount === 0) {
                warn('pluginMain', 'Toolbar button create failed for all known locations (non-fatal)');
            }
        }

    } catch (e) {
        warn('pluginMain', 'registerDesktopToggle failed (non-fatal):', e);
    }
}
