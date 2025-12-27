// src/main/uiBridge/panelController.ts
import {ensureAllEventsCache, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';

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


/**
 * IMPORTANT: we leave expandAllInRange and buildICS temporarily in pluginMain.ts (as it was),
 * but so that there are no cyclic imports - we pass them as parameters.
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
                    // If the UI transmits the already read text of the file
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
                    const targetFolderId = typeof msg.targetFolderId === 'string' ? msg.targetFolderId : undefined;
                    const res = await importIcsIntoNotes(joplin, ics, sendStatus, targetFolderId);
                    invalidateAllEventsCache(); // to update the calendar

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

            if (msg?.name === 'requestFolders') {
                const rows = await getAllFolders(joplin);
                const folders = flattenFolderTree(rows);
                await joplin.views.panels.postMessage(panelId, {name: 'folders', folders});
                return;
            }


            // unknown msg - no-op
        } catch (e) {
            console.error('[MyCalendar] onMessage error:', e);
        }
    });
}
