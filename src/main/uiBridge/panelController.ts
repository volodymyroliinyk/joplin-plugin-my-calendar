// src/main/uiBridge/panelController.ts

import {ensureAllEventsCache, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';
import {showToast} from '../utils/toast';
import {getDebugEnabled, getWeekStart} from "../settings/settings";
import {setDebugEnabled} from "../utils/logger";

type FolderRow = { id: string; title: string; parent_id?: string | null };
type FolderOption = { id: string; title: string; parent_id?: string | null; depth: number };

async function getAllFolders(joplin: any): Promise<FolderRow[]> {
    const out: FolderRow[] = [];
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['folders'], {
            page,
            limit: 100,
            fields: ['id', 'title', 'parent_id'],
        });

        if (res?.items?.length) out.push(...res.items);
        if (!res?.has_more) break;
        page++;
    }

    return out;
}

function flattenFolderTree(rows: FolderRow[]): FolderOption[] {
    const byId = new Map<string, FolderRow & { children: FolderRow[] }>();

    for (const r of rows) byId.set(r.id, {...r, children: []});

    const roots: (FolderRow & { children: FolderRow[] })[] = [];

    for (const r of byId.values()) {
        const pid = r.parent_id || '';
        const parent = pid ? byId.get(pid) : undefined;

        if (parent) parent.children.push(r);
        else roots.push(r);
    }

    const sortFn = (a: FolderRow, b: FolderRow) =>
        a.title.localeCompare(b.title, undefined, {sensitivity: 'base'});

    const walk = (node: FolderRow & { children: FolderRow[] }, depth: number, acc: FolderOption[]) => {
        acc.push({id: node.id, title: node.title, parent_id: node.parent_id ?? null, depth});

        node.children.sort(sortFn);
        for (const ch of node.children) walk(ch as any, depth + 1, acc);
    };

    roots.sort(sortFn);

    const acc: FolderOption[] = [];
    for (const r of roots) walk(r, 0, acc);

    return acc;
}

async function pushUiSettings(joplin: any, panel: string) {
    const weekStart = await getWeekStart(joplin);
    console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    const debug = await getDebugEnabled(joplin);

    // Main-side logger should follow the same setting
    setDebugEnabled(!!debug);

    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;
    console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    await pm(panel, {name: 'uiSettings', weekStart, debug: !!debug});
}


/**
 * IMPORTANT: we leave expandAllInRange and buildICS temporarily in pluginMain.ts (as it was),
 * but so that there are no cyclic imports - we pass them as parameters.
 */
export async function registerCalendarPanelController(
    joplin: any,
    panel: string,
    helpers: {
        expandAllInRange: (events: any[], fromUtc: number, toUtc: number) => any[];
        buildICS: (events: any[]) => string;
    }
) {
    await joplin.views.panels.onMessage(panel, async (msg: any) => {
        try {
            // --- UI handshake ---
            if (msg?.name === 'uiReady') {
                await pushUiSettings(joplin, panel);
                // Force a redraw so weekStart takes effect immediately.
                const pm = joplin?.views?.panels?.postMessage;
                if (typeof pm === 'function') {
                    await pm(panel, {name: 'redrawMonth'});
                }
                return;
            }

            // --- Range events for calendar grid ---
            if (msg?.name === 'requestRangeEvents') {
                const all = await ensureAllEventsCache(joplin);
                const list = helpers.expandAllInRange(all, msg.fromUtc, msg.toUtc);

                await joplin.views.panels.postMessage(panel, {
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

                await joplin.views.panels.postMessage(panel, {
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

                await joplin.views.panels.postMessage(panel, {
                    name: 'rangeIcs',
                    ics,
                    filename: `mycalendar_${new Date(msg.fromUtc).toISOString().slice(0, 10)}_${new Date(
                        msg.toUtc
                    ).toISOString().slice(0, 10)}.ics`,
                });
                return;
            }

            // --- ICS import (text/file) from UI ---
            if (msg?.name === 'icsImport') {
                const sendStatus = async (text: string) => {
                    await joplin.views.panels.postMessage(panel, {
                        name: 'importStatus',
                        text,
                    });

                    await showToast('info', text, 2000);
                };

                try {
                    const targetFolderId = typeof msg.targetFolderId === 'string' ? msg.targetFolderId : undefined;
                    const preserveLocalColor = msg.preserveLocalColor !== false; // default true

                    const importDefaultColor =
                        typeof msg.importDefaultColor === 'string' &&
                        /^#[0-9a-fA-F]{6}$/.test(msg.importDefaultColor)
                            ? msg.importDefaultColor
                            : undefined;

                    const res = await importIcsIntoNotes(
                        joplin,
                        msg.ics,
                        sendStatus,
                        targetFolderId,
                        preserveLocalColor,
                        importDefaultColor
                    );

                    invalidateAllEventsCache();

                    await joplin.views.panels.postMessage(panel, {
                        name: 'importDone',
                        ...res,
                    });

                    const doneText = `ICS import finished: added=${res.added}, updated=${res.updated}, skipped=${res.skipped}, errors=${res.errors}`;
                    await showToast(res.errors > 0 ? 'warning' : 'success', doneText, 4000);

                } catch (e: any) {
                    const errText = String(e?.message || e);

                    await joplin.views.panels.postMessage(panel, {
                        name: 'importError',
                        error: errText,
                    });

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


            // unknown msg - no-op
        } catch (e) {
            console.error('[MyCalendar] onMessage error:', e);
        }
    });
}