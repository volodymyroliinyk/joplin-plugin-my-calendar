// src/main/uiBridge/panelController.ts

import {ensureAllEventsCache, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';
import {showToast} from '../utils/toast';
import {pushUiSettings} from "./uiSettings";
import {err} from '../utils/logger';
import {getIcsImportAlarmRangeDays} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {getAllFolders, flattenFolderTree} from '../services/folderService';

function isoDate(utc: number): string {
    return new Date(utc).toISOString().slice(0, 10);
}

function buildRangeIcsFilename(fromUtc: number, toUtc: number): string {
    return `mycalendar_${isoDate(fromUtc)}_${isoDate(toUtc)}.ics`;
}

export async function registerCalendarPanelController(
    joplin: Joplin,
    panel: string,
    helpers: {
        expandAllInRange: (events: any[], fromUtc: number, toUtc: number) => any[];
        buildICS: (events: any[]) => string;
    }
) {
    await joplin.views.panels.onMessage(panel, async (msg: any) => {
        try {
            if (msg?.name === 'uiReady') {
                await pushUiSettings(joplin, panel);
                await joplin.views.panels.postMessage(panel, {name: 'redrawMonth'});
                return;
            }

            if (msg?.name === 'requestRangeEvents') {
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);
                await joplin.views.panels.postMessage(panel, {name: 'rangeEvents', events: list});
                return;
            }

            if (msg?.name === 'dateClick') {
                const dayStart = msg.dateUtc;
                const dayEnd = dayStart + (24 * 60 * 60 * 1000) - 1;
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, dayStart, dayEnd).filter(
                    (e: any) => e.startUtc >= dayStart && e.startUtc <= dayEnd
                );
                await joplin.views.panels.postMessage(panel, {
                    name: 'showEvents',
                    dateUtc: msg.dateUtc,
                    events: list,
                });
                return;
            }

            if (msg?.name === 'openNote' && msg.id) {
                await joplin.commands.execute('openNote', msg.id);
                return;
            }

            if (msg?.name === 'exportRangeIcs' && typeof msg.fromUtc === 'number' && typeof msg.toUtc === 'number') {
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);
                const ics = helpers.buildICS(list);
                await joplin.views.panels.postMessage(panel, {
                    name: 'rangeIcs',
                    ics,
                    filename: buildRangeIcsFilename(msg.fromUtc, msg.toUtc),
                });
                return;
            }

            if (msg?.name === 'icsImport') {
                const sendStatus = async (text: string) => {
                    await joplin.views.panels.postMessage(panel, {name: 'importStatus', text});
                    await showToast('info', text, 5000);
                };

                try {
                    const targetFolderId = typeof msg.targetFolderId === 'string' ? msg.targetFolderId : undefined;
                    const preserveLocalColor = msg.preserveLocalColor !== false;
                    const importDefaultColor = (typeof msg.importDefaultColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(msg.importDefaultColor))
                        ? msg.importDefaultColor : undefined;

                    const importAlarmRangeDays = await getIcsImportAlarmRangeDays(joplin);

                    const res = await importIcsIntoNotes(
                        joplin, msg.ics, sendStatus, targetFolderId, preserveLocalColor, importDefaultColor, importAlarmRangeDays
                    );

                    invalidateAllEventsCache();
                    await joplin.views.panels.postMessage(panel, {name: 'importDone', ...res});

                    const doneText = `ICS import finished: added=${res.added}, updated=${res.updated}, skipped=${res.skipped}, errors=${res.errors}, alarmsCreated=${res.alarmsCreated}, alarmsDeleted=${res.alarmsDeleted}`;
                    await showToast(res.errors > 0 ? 'warning' : 'success', doneText, 5000);
                } catch (e: any) {
                    const errText = String(e?.message || e);
                    await joplin.views.panels.postMessage(panel, {name: 'importError', error: errText});
                    await showToast('error', `ICS import failed: ${errText}`, 5000);
                }
                return;
            }

            if (msg?.name === 'requestFolders') {
                const rows = await getAllFolders(joplin);
                const folders = flattenFolderTree(rows);
                await joplin.views.panels.postMessage(panel, {name: 'folders', folders});
                return;
            }
        } catch (e) {
            err('panelController', 'onMessage error:', e);
        }
    });
}
