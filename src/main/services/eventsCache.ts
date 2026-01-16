// src/main/services/eventsCache.ts

import {parseEventsFromBody, EventInput} from '../parsers/eventParser';
import {log, err} from '../utils/logger';

type JoplinLike = {
    data: {
        get: (
            path: any[],
            query: { fields: string[]; limit: number; page: number }
        ) => Promise<{ items?: any[]; has_more?: boolean }>;
    };
};

const NOTE_FIELDS = ['id', 'title', 'body'] as const;
const PAGE_LIMIT = 100;

const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;

// Guard against concurrent rebuilds
let rebuildPromise: Promise<void> | null = null;

export function invalidateAllEventsCache(): void {
    allEventsCache = null;
    eventCacheByNote.clear();
}

export function invalidateNote(noteId: string): void {
    eventCacheByNote.delete(noteId);
    allEventsCache = null;
}

async function fetchAllNotes(joplin: JoplinLike): Promise<any[]> {
    const items: any[] = [];
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['notes'], {
            fields: [...NOTE_FIELDS],
            limit: PAGE_LIMIT,
            page,
        });

        for (const n of res.items || []) items.push(n);
        if (!res.has_more) break;
        page++;
    }

    return items;
}

function extractEventsFromNote(n: any): { noteId: string; events: EventInput[] } | null {
    const noteId = String(n?.id || '');
    const title = String(n?.title || '');
    const body = typeof n?.body === 'string' ? n.body : '';

    if (!noteId || !body) return null;

    const evs = parseEventsFromBody(noteId, title, body) || [];
    if (!evs.length) return null;

    // Ensure noteId is present for UI
    const withNoteId = evs.map((e) => ({...(e as any), noteId})) as EventInput[];

    return {noteId, events: withNoteId};
}

export async function rebuildAllEventsCache(joplin: JoplinLike): Promise<void> {
    // If a rebuild is already running, just await it
    if (rebuildPromise) {
        await rebuildPromise;
        return;
    }

    rebuildPromise = (async () => {
        try {
            log('rebuildAllEventsCache: start');

            eventCacheByNote.clear();
            const notes = await fetchAllNotes(joplin);

            const all: EventInput[] = [];

            for (const n of notes) {
                const extracted = extractEventsFromNote(n);
                if (!extracted) continue;

                eventCacheByNote.set(extracted.noteId, extracted.events);
                all.push(...extracted.events);
            }

            allEventsCache = all;
            log('rebuildAllEventsCache: done events=', allEventsCache.length);
        } catch (error) {
            err('rebuildAllEventsCache: error', error);
            // Keep cache usable + avoid "stuck" state
            allEventsCache = allEventsCache || [];
        }
    })();

    try {
        await rebuildPromise;
    } finally {
        rebuildPromise = null;
    }
}

export async function ensureAllEventsCache(joplin: JoplinLike): Promise<EventInput[]> {
    if (!allEventsCache) {
        await rebuildAllEventsCache(joplin);
    }
    return allEventsCache || [];
}
