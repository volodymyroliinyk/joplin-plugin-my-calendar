// src/main/uiBridge/panelController.ts

import {ensureAllEventsCache, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';
import {showToast} from '../utils/toast';
import {pushUiSettings} from './uiSettings';
import {err} from '../utils/logger';
import {getIcsImportAlarmRangeDays} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {getAllFolders, flattenFolderTree} from '../services/folderService';

function isoDate(utc: number): string {
    return new Date(utc).toISOString().slice(0, 10);
}

function isNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isString(v: unknown): v is string {
    return typeof v === 'string';
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
}

const KNOWN_MSG_NAMES = [
    'uiReady',
    'requestRangeEvents',
    'dateClick',
    'openNote',
    'exportRangeIcs',
    'icsImport',
    'requestFolders',
] as const;

type KnownMsgName = typeof KNOWN_MSG_NAMES[number];

function isKnownMsgName(v: unknown): v is KnownMsgName {
    return isString(v) && (KNOWN_MSG_NAMES as readonly string[]).includes(v);
}

type PanelMsg =
    | { name: 'uiReady' }
    | { name: 'requestRangeEvents'; fromUtc: number; toUtc: number }
    | { name: 'dateClick'; dateUtc: number }
    | { name: 'openNote'; id?: string }
    | { name: 'exportRangeIcs'; fromUtc: number; toUtc: number }
    | {
    name: 'icsImport';
    ics?: string;
    targetFolderId?: unknown;
    preserveLocalColor?: boolean;
    importDefaultColor?: unknown;
}
    | { name: 'requestFolders' };


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
    const post = (message: any) => joplin.views.panels.postMessage(panel, message);

    await joplin.views.panels.onMessage(panel, async (rawMsg: unknown) => {
        try {
            if (!isRecord(rawMsg) || !isKnownMsgName(rawMsg.name)) return;
            const msg = rawMsg as PanelMsg;

            switch (msg.name) {
                case 'uiReady': {
                    await pushUiSettings(joplin, panel);
                    await post({name: 'redrawMonth'});
                    return;
                }

                case 'requestRangeEvents': {
                    if (!isNumber(msg.fromUtc) || !isNumber(msg.toUtc)) return;
                    const all = await ensureAllEventsCache(joplin);
                    const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);
                    await post({name: 'rangeEvents', events: list});
                    return;
                }

                case 'dateClick': {
                    if (!isNumber(msg.dateUtc)) return;

                    const dayStart = msg.dateUtc;
                    const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;

                    const all = await ensureAllEventsCache(joplin);
                    const list = helpers
                        .expandAllInRange(all, dayStart, dayEnd)
                        .filter((e: any) => isNumber(e?.startUtc) && e.startUtc >= dayStart && e.startUtc <= dayEnd);

                    await post({
                        name: 'showEvents',
                        dateUtc: msg.dateUtc,
                        events: list,
                    });
                    return;
                }

                case 'openNote': {
                    if (msg.id) {
                        await joplin.commands.execute('openNote', msg.id);
                    }
                    return;
                }

                case 'exportRangeIcs': {
                    if (!isNumber(msg.fromUtc) || !isNumber(msg.toUtc)) return;

                    const all = await ensureAllEventsCache(joplin);
                    const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);
                    const ics = helpers.buildICS(list);

                    await post({
                        name: 'rangeIcs',
                        ics,
                        filename: buildRangeIcsFilename(msg.fromUtc, msg.toUtc),
                    });
                    return;
                }

                case 'icsImport': {
                    const sendStatus = async (text: string) => {
                        await post({name: 'importStatus', text});
                        await showToast('info', text, 5000);
                    };

                    try {
                        if (!isString(msg.ics) || msg.ics.length === 0) {
                            const errText = 'Missing ICS content';
                            await post({name: 'importError', error: errText});
                            await showToast('error', `ICS import failed: ${errText}`, 5000);
                            return;
                        }

                        const targetFolderId = isString(msg.targetFolderId) ? msg.targetFolderId : undefined;
                        const preserveLocalColor = msg.preserveLocalColor !== false;

                        const importDefaultColor =
                            isString(msg.importDefaultColor) && /^#[0-9a-fA-F]{6}$/.test(msg.importDefaultColor)
                                ? msg.importDefaultColor
                                : undefined;

                        const importAlarmRangeDays = await getIcsImportAlarmRangeDays(joplin);

                        const res = await importIcsIntoNotes(
                            joplin,
                            msg.ics,
                            sendStatus,
                            targetFolderId,
                            preserveLocalColor,
                            importDefaultColor,
                            importAlarmRangeDays
                        );

                        invalidateAllEventsCache();
                        await post({name: 'importDone', ...res});

                        const doneText = `ICS import finished: added=${res.added}, updated=${res.updated}, skipped=${res.skipped}, errors=${res.errors}, alarmsCreated=${res.alarmsCreated}, alarmsDeleted=${res.alarmsDeleted}`;
                        await showToast(res.errors > 0 ? 'warning' : 'success', doneText, 5000);
                    } catch (e: any) {
                        const errText = String(e?.message || e);
                        await post({name: 'importError', error: errText});
                        await showToast('error', `ICS import failed: ${errText}`, 5000);
                    }
                    return;
                }

                case 'requestFolders': {
                    const rows = await getAllFolders(joplin);
                    const folders = flattenFolderTree(rows);
                    await post({name: 'folders', folders});
                    return;
                }

                default:
                    return;
            }
        } catch (e) {
            err('panelController', 'onMessage error:', e);
        }
    });
}
