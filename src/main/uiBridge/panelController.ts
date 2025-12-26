// src/main/uiBridge/panelController.ts
import {ensureAllEventsCache, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';

/**
 * ВАЖЛИВО: expandAllInRange і buildICS залишаємо тимчасово в pluginMain.ts (як було),
 * але щоб не було циклічних імпортів - ми передамо їх як параметри.
 */
export async function registerCalendarPanelController(
    joplin: any,
    panelId: string,
    helpers: {
        expandAllInRange: (events: any[], fromUtc: number, toUtc: number) => any[];
        buildICS: (events: any[]) => string;
    }
) {
    await joplin.views.panels.onMessage(panelId, async (msg: any) => {
        try {
            // --- UI handshake ---
            if (msg?.name === 'uiReady') {
                await joplin.views.panels.postMessage(panelId, {name: 'uiAck'});
                return;
            }

            // --- Range events for calendar grid ---
            if (msg?.name === 'requestRangeEvents') {
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);

                await joplin.views.panels.postMessage(panelId, {
                    name: 'rangeEvents',
                    events: list,
                });
                return;
            }

            // --- Click on day -> list events ---
            if (msg?.name === 'dateClick') {
                const dayStart = msg.dateUtc;
                const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;

                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, dayStart, dayEnd).filter(
                    (e: any) => e.startUtc >= dayStart && e.startUtc <= dayEnd
                );

                await joplin.views.panels.postMessage(panelId, {
                    name: 'showEvents',
                    dateUtc: msg.dateUtc,
                    events: list,
                });
                return;
            }

            // --- Open note ---
            if (msg?.name === 'openNote' && msg.id) {
                await joplin.commands.execute('openNote', msg.id);
                return;
            }

            // --- Export range to ICS ---
            if (msg?.name === 'exportRangeIcs' && typeof msg.fromUtc === 'number' && typeof msg.toUtc === 'number') {
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);
                const ics = helpers.buildICS(list);

                await joplin.views.panels.postMessage(panelId, {
                    name: 'rangeIcs',
                    ics,
                    filename: `mycalendar_${new Date(msg.fromUtc).toISOString().slice(0, 10)}_${new Date(
                        msg.toUtc
                    ).toISOString().slice(0, 10)}.ics`,
                });
                return;
            }

            // --- ICS import (text/file) from UI ---
            if (msg?.name === 'icalImport') {
                const sendStatus = async (text: string) => {
                    await joplin.views.panels.postMessage(panelId, {name: 'importStatus', text});
                };

                const mode = msg.mode;

                let ics = '';
                if (mode === 'text') {
                    ics = typeof msg.ics === 'string' ? msg.ics : '';
                } else if (mode === 'file') {
                    // Якщо UI передає вже прочитаний текст файла
                    ics = typeof msg.ics === 'string' ? msg.ics : '';
                }

                if (!ics || !ics.trim()) {
                    await joplin.views.panels.postMessage(panelId, {
                        name: 'importError',
                        error: 'ICS content is empty'
                    });
                    return;
                }

                try {
                    const res = await importIcsIntoNotes(joplin, ics, sendStatus);
                    invalidateAllEventsCache(); // щоб календар оновився

                    await joplin.views.panels.postMessage(panelId, {
                        name: 'importDone',
                        ...res,
                    });
                } catch (e: any) {
                    await joplin.views.panels.postMessage(panelId, {
                        name: 'importError',
                        error: String(e?.message || e),
                    });
                }

                return;
            }

            // unknown msg - no-op
        } catch (e) {
            console.error('[MyCalendar] onMessage error:', e);
        }
    });
}
