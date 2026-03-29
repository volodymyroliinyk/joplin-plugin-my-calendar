// src/main/pluginMain.ts

import {createCalendarPanel} from './views/calendarView';

import {ensureAllEventsCache, invalidateAllEventsCache, refreshNoteCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';
import {AUTOMATED_ICS_IMPORT_SETTING_KEYS, registerSettings} from './settings/settings';
import {pushUiSettings} from "./uiBridge/uiSettings";
import {expandAllInRange} from './services/occurrenceService';
import {Occurrence} from './utils/dateUtils';
import {Joplin} from './types/joplin.interface';
import {startAutomatedIcsImport} from './services/automatedIcsImportService';

import {err, info, log, warn} from './utils/logger';

let pluginStartPromise: Promise<void> | null = null;

function pad2(n: number) {
    return String(n).padStart(2, '0');
}

function fmtICS(tsUtc: number) {
    const d = new Date(tsUtc);
    return d.getUTCFullYear().toString() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
        'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function icsEscape(s: string) {
    return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldIcsLine(line: string, limit = 75): string[] {
    if (line.length <= limit) return [line];
    const out: string[] = [];
    let i = 0;
    while (i < line.length) {
        const chunk = line.slice(i, i + limit);
        if (i === 0) out.push(chunk);
        else out.push(` ${chunk}`);
        i += limit;
    }
    return out;
}

function buildICS(events: Occurrence[], prodId = '-//MyCalendar//Joplin//EN') {
    const lines: string[] = [];
    const push = (line: string) => {
        for (const l of foldIcsLine(line)) lines.push(l);
    };

    push('BEGIN:VCALENDAR');
    push('VERSION:2.0');
    push(`PRODID:${prodId}`);
    push('CALSCALE:GREGORIAN');

    for (const ev of events) {
        const uid = ev.occurrenceId || `${ev.id}@mycalendar`;
        push('BEGIN:VEVENT');
        push(`UID:${icsEscape(uid)}`);
        push(`DTSTAMP:${fmtICS(Date.now())}`);
        push(`DTSTART:${fmtICS(ev.startUtc)}`);
        if (ev.endUtc) push(`DTEND:${fmtICS(ev.endUtc)}`);
        push(`SUMMARY:${icsEscape(ev.title || 'Event')}`);
        if (ev.location) push(`LOCATION:${icsEscape(ev.location)}`);
        if (ev.description) push(`DESCRIPTION:${icsEscape(ev.description)}`);
        if (ev.color) push(`X-COLOR:${icsEscape(ev.color)}`);
        push('END:VEVENT');
    }
    push('END:VCALENDAR');
    return lines.join('\r\n');
}

async function safePostMessage(joplin: Joplin, panelId: string, message: unknown): Promise<void> {
    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm === 'function') await pm(panelId, message);
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


async function startPlugin(joplin: Joplin): Promise<void> {
    log('pluginMain', 'Plugin start');

    await registerSettings(joplin);

    const panel = await createCalendarPanel(joplin);
    log('pluginMain', 'Panel created:', panel);

    await registerCalendarPanelController(joplin, panel, {
        expandAllInRange,
        buildICS,
    });

    const automatedIcsImport = await startAutomatedIcsImport(joplin, {
        onAfterImport: async () => {
            await safePostMessage(joplin, panel, {name: 'redrawMonth'});
        },
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

    const toggleState = {
        visible: true,
        // Indicates whether desktop menu/toolbar were registered successfully.
        active: false,
    };

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
            try {
                await pushUiSettings(joplin, panel);
            } catch (e) {
                warn('pluginMain', 'pushUiSettings failed in open command (non-fatal):', e);
            }
            try {
                // const pm = joplin?.views?.panels?.postMessage;
                // if (typeof pm === 'function') await pm(panel, {name: 'redrawMonth'});
                await safePostMessage(joplin, panel, {name: 'redrawMonth'});
            } catch (_err) {
                // ignore
            }
            await focusPanelIfSupported(joplin, panel);

            // Sync toggle state
            toggleState.visible = true;
            // await toggleState.update();
        },
    });

    await joplin.workspace?.onNoteChange?.(async ({id}: { id?: string }) => {
        if (id) await refreshNoteCache(joplin, id);
    });

    await joplin.workspace?.onSyncComplete?.(async () => {
        invalidateAllEventsCache();
    });

    try {
        await pushUiSettings(joplin, panel);
    } catch (e) {
        warn('pluginMain', 'Initial pushUiSettings failed (non-fatal):', e);
    }

    // await joplin.views.panels.show(panel);

    const onSettingsChange = joplin?.settings?.onChange;
    if (typeof onSettingsChange === 'function') {
        try {
            await onSettingsChange(async (event?: { keys?: string[] }) => {
                await pushUiSettings(joplin, panel);
                const keys = Array.isArray(event?.keys) ? event.keys : [];
                if (!keys.some((key) => AUTOMATED_ICS_IMPORT_SETTING_KEYS.includes(key as typeof AUTOMATED_ICS_IMPORT_SETTING_KEYS[number]))) {
                    return;
                }
                await automatedIcsImport.refresh();
            });
        } catch (e) {
            warn('pluginMain', 'settings.onChange registration failed (non-fatal):', e);
        }
    } else {
        info('pluginMain', 'settings.onChange not available - skip');
    }

    try {
        await pushUiSettings(joplin, panel);
    } catch (e) {
        warn('pluginMain', 'pushUiSettings after toggle setup failed (non-fatal):', e);
    }

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
async function registerToggleCommand(joplin: Joplin, panel: string, toggleState: {
    visible: boolean
}): Promise<string> {
    const execute = async () => {
        const nextVisible = !toggleState.visible;
        if (nextVisible) {
            await joplin.views.panels.show(panel);
            toggleState.visible = true;
            log('pluginMain', 'Toggle: Show');
        } else {
            const hide = joplin.views?.panels?.hide;
            if (typeof hide === 'function') {
                await hide(panel);
                toggleState.visible = false;
                log('pluginMain', 'Toggle: Hide');
                return;
            }

            // Fallback for Joplin builds where `panels.hide` is not exposed.
            const show = joplin.views?.panels?.show as ((panelId: string, visible?: boolean) => Promise<void>) | undefined;
            if (typeof show === 'function') {
                try {
                    await show(panel, false);
                    toggleState.visible = false;
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
            label: 'Toggle My Calendar',
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
                label: 'Toggle My Calendar',
                execute,
            });
            return true;
        } catch (e) {
            warn('pluginMain', `Toggle command register without icon failed for "${name}":`, e);
            return false;
        }
    };

    const candidates = ['mycalendar.togglePanel', 'mycalendar.togglePanelV2'];
    for (const name of candidates) {
        if (await registerByName(name)) {
            return name;
        }
    }

    throw new Error('Failed to register toggle command');
}

// === MyCalendar: safe desktop toggle helper ===
async function registerDesktopToggle(joplin: Joplin, panel: string, toggleState: {
    visible: boolean;
    active?: boolean
}, toggleCommandName: string, toggleCommandError?: string) {
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
            const menuTargets = [
                {id: 'mycalendarToggleMenuView', location: 'view'},
                {id: 'mycalendarToggleMenuTools', location: 'tools'},
            ];
            let menuRegisteredCount = 0;
            for (const target of menuTargets) {
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
            const toolbarTargets = [
                {id: 'mycalendarToolbarButtonNote', location: 'noteToolbar'},
                {id: 'mycalendarToolbarButtonEditor', location: 'editorToolbar'},
            ];
            let toolbarRegisteredCount = 0;
            for (const target of toolbarTargets) {
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
