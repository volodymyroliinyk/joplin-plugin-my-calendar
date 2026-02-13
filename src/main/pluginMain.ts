// src/main/pluginMain.ts

import {createCalendarPanel} from './views/calendarView';

import {ensureAllEventsCache, invalidateAllEventsCache, refreshNoteCache} from './services/eventsCache';
import {registerCalendarPanelController} from './uiBridge/panelController';
import {registerSettings} from './settings/settings';
import {pushUiSettings} from "./uiBridge/uiSettings";
import {expandAllInRange} from './services/occurrenceService';
import {Occurrence} from './utils/dateUtils';
import {Joplin} from './types/joplin.interface';

import {err, info, log, warn} from './utils/logger';

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


export default async function runPlugin(joplin: Joplin) {

    log('pluginMain', 'Plugin start');

    await registerSettings(joplin);

    const panel = await createCalendarPanel(joplin);
    log('pluginMain', 'Panel created:', panel);

    await registerCalendarPanelController(joplin, panel, {
        expandAllInRange,
        buildICS,
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

    await registerToggleCommand(joplin, panel, toggleState);

    await joplin.commands.register({
        name: 'mycalendar.open',
        label: 'Open MyCalendar',
        execute: async () => {
            await joplin.views.panels.show(panel);
            // Ensure the UI gets the latest weekStart when the panel becomes visible.
            await pushUiSettings(joplin, panel);
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

    await pushUiSettings(joplin, panel);

    // await joplin.views.panels.show(panel);

    await joplin.settings.onChange(async () => {
        await pushUiSettings(joplin, panel);
    });

    await registerDesktopToggle(joplin, panel, toggleState);

    // --- Create the import panel (desktop)

    await focusPanelIfSupported(joplin, panel);
}

// Register the toggle command once. The label is intentionally static because
// dynamic label updates are not reliably supported by Joplin's menu API.
async function registerToggleCommand(joplin: Joplin, panel: string, toggleState: { visible: boolean }) {
    await joplin.commands.register({
        name: 'mycalendar.togglePanel',
        label: 'Toggle My Calendar',
        iconName: 'fas fa-calendar-alt',
        execute: async () => {
            toggleState.visible = !toggleState.visible;
            if (toggleState.visible) {
                await joplin.views.panels.show(panel);
                log('pluginMain', 'Toggle: Show');
            } else {
                if (joplin.views?.panels?.hide) {
                    await joplin.views.panels.hide(panel);
                }
                log('pluginMain', 'Toggle: Hide');
            }
        },
    });
}

// === MyCalendar: safe desktop toggle helper ===
async function registerDesktopToggle(joplin: Joplin, panel: string, toggleState: {
    visible: boolean;
    active?: boolean
}) {
    try {
        const canShow = !!joplin?.views?.panels?.show;
        const canHide = !!joplin?.views?.panels?.hide;
        const canMenu = !!joplin?.views?.menuItems?.create;

        info('pluginMain', 'Toggle capabilities:', {canShow, canHide, canMenu, panel});

        if (!canShow || !canHide) {
            info('pluginMain', 'Toggle: panels.show/hide not available - skip');
            return;
        }

        toggleState.active = true;
        // Initial update to ensure label is correct
        // (no-op) label is intentionally static

        const menuCreate = joplin.views?.menuItems?.create;
        if (typeof menuCreate === 'function') {
            try {
                await menuCreate(
                    'mycalendarToggleMenu',
                    'mycalendar.togglePanel',
                    'view',
                    {accelerator: 'Ctrl+Alt+C'}
                );
                log('pluginMain', 'Toggle menu item registered');
            } catch (e) {
                warn('pluginMain', 'Menu create failed (non-fatal):', e);
            }
        }

        const toolbarCreate = joplin.views?.toolbarButtons?.create;
        if (typeof toolbarCreate === 'function') {
            try {
                await toolbarCreate(
                    'mycalendarToolbarButton',
                    'mycalendar.togglePanel',
                    'noteToolbar'
                );
                log('pluginMain', 'Toolbar button registered');
            } catch (e) {
                warn('pluginMain', 'Toolbar button create failed (non-fatal):', e);
            }
        }

    } catch (e) {
        warn('pluginMain', 'registerDesktopToggle failed (non-fatal):', e);
    }
}
