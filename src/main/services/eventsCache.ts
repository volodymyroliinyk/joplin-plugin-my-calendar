// src/main/services/eventsCache.ts

import {parseEventsFromBody, EventInput} from '../parsers/eventParser';
import {log, err} from '../utils/logger';

type JoplinLike = {
    data: {
        get: (
            path: string[],
            query?: { fields?: string[]; limit?: number; page?: number }
        ) => Promise<NoteRow | NotesPage>;
    };
};

type NoteRow = {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    is_todo?: unknown;
    todo_completed?: unknown;
};

type NotesPage = {
    items?: NoteRow[];
    has_more?: boolean;
};

const NOTE_FIELDS = ['id', 'title', 'body', 'is_todo', 'todo_completed'] as const;
const PAGE_LIMIT = 100;

const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;
let cacheVersion = 0;
let lastRebuildFailed = false;
let nextNoteRefreshId = 0;
const latestNoteRefreshById = new Map<string, number>();

// Guard against concurrent rebuilds
let rebuildPromise: Promise<void> | null = null;

export function invalidateAllEventsCache(): void {
    cacheVersion++;
    lastRebuildFailed = false;
    allEventsCache = null;
    eventCacheByNote.clear();
    latestNoteRefreshById.clear();
}

export function invalidateNote(noteId: string): void {
    cacheVersion++;
    lastRebuildFailed = false;
    eventCacheByNote.delete(noteId);
    latestNoteRefreshById.delete(noteId);
    allEventsCache = null;
}

export function getEventsCacheVersion(): number {
    return cacheVersion;
}

export async function refreshNoteCache(joplin: JoplinLike, noteId: string): Promise<void> {
    const refreshId = ++nextNoteRefreshId;
    latestNoteRefreshById.set(noteId, refreshId);

    // Avoid races with full rebuild.
    if (rebuildPromise) {
        await rebuildPromise;
    }

    // If cache isn't built yet, keep it invalidated and let the next read rebuild.
    if (!allEventsCache) {
        eventCacheByNote.delete(noteId);
        return;
    }

    const refreshVersion = cacheVersion;
    const isCurrentRefresh = (): boolean =>
        cacheVersion === refreshVersion && latestNoteRefreshById.get(noteId) === refreshId;

    try {
        const res = await joplin.data.get(['notes', noteId], {fields: [...NOTE_FIELDS]}) as NoteRow;
        // Discard a response if a cache generation changed or a newer refresh for
        // the same note started while this request was in flight.
        if (!allEventsCache || !isCurrentRefresh()) return;

        const extracted = extractEventsFromNote(res);

        // Update per-note cache
        if (extracted) {
            eventCacheByNote.set(noteId, extracted.events);
        } else {
            eventCacheByNote.delete(noteId);
        }

        // Rebuild aggregated cache incrementally
        const filtered = allEventsCache.filter(e => e.id !== noteId);
        allEventsCache = extracted ? filtered.concat(extracted.events) : filtered;
        cacheVersion++;
        lastRebuildFailed = false;
    } catch (error) {
        // An obsolete failure must not remove data installed by a newer refresh or rebuild.
        if (!isCurrentRefresh()) return;
        // Note could be deleted or not accessible; remove its cache entries.
        eventCacheByNote.delete(noteId);
        if (allEventsCache) {
            allEventsCache = allEventsCache.filter(e => e.id !== noteId);
        }
        cacheVersion++;
        lastRebuildFailed = false;
        err('eventsCache', 'Error refreshing note cache:', error);
    }
}

async function fetchAllNotes(joplin: JoplinLike): Promise<NoteRow[]> {
    const items: NoteRow[] = [];
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['notes'], {
            fields: [...NOTE_FIELDS],
            limit: PAGE_LIMIT,
            page,
        }) as NotesPage;

        for (const n of res.items || []) items.push(n);
        if (!res.has_more) break;
        page++;
    }

    return items;
}

function extractEventsFromNote(n: NoteRow): { noteId: string; events: EventInput[] } | null {
    const noteId = String(n?.id || '');
    const title = String(n?.title || '');
    const body = typeof n?.body === 'string' ? n.body : '';

    if (!noteId || !body) return null;

    const evs = parseEventsFromBody(noteId, title, body) || [];
    if (!evs.length) return null;

    // Ensure note metadata is present for UI.
    const isTodo = Number(n?.is_todo || 0);
    const todoCompleted = Number(n?.todo_completed || 0);
    const isCompleted = isTodo === 1 && todoCompleted > 0 ? 1 : 0;
    const withNoteId: EventInput[] = evs.map((e) => ({
        ...e,
        noteId,
        is_todo: isTodo,
        todo_completed: todoCompleted,
        is_completed: isCompleted,
    }));

    return {noteId, events: withNoteId};
}

export async function rebuildAllEventsCache(joplin: JoplinLike): Promise<void> {
    // If a rebuild is already running, just await it
    if (rebuildPromise) {
        await rebuildPromise;
        return;
    }

    const rebuildVersion = cacheVersion;

    rebuildPromise = (async () => {
        try {
            log('eventsCache', 'Rebuilding all events cache...');

            const notes = await fetchAllNotes(joplin);

            if (cacheVersion !== rebuildVersion) {
                log('eventsCache', 'Skipping stale events cache rebuild result');
                return;
            }

            const nextByNote = new Map<string, EventInput[]>();
            const all: EventInput[] = [];

            for (const n of notes) {
                const extracted = extractEventsFromNote(n);
                if (!extracted) continue;

                nextByNote.set(extracted.noteId, extracted.events);
                all.push(...extracted.events);
            }

            if (cacheVersion !== rebuildVersion) {
                log('eventsCache', 'Skipping stale events cache rebuild result');
                return;
            }

            eventCacheByNote.clear();
            for (const [noteId, events] of nextByNote) {
                eventCacheByNote.set(noteId, events);
            }
            allEventsCache = all;
            lastRebuildFailed = false;
            log('eventsCache', 'Rebuild complete. Events found:', allEventsCache.length);
        } catch (error) {
            err('eventsCache', 'Error rebuilding events cache:', error);
            lastRebuildFailed = true;
            // Keep cache usable for the current request; ensureAllEventsCache() will retry
            // on the next request while lastRebuildFailed remains true.
            if (!allEventsCache) allEventsCache = [];
        }
    })();

    try {
        await rebuildPromise;
    } finally {
        rebuildPromise = null;
    }
}

export async function ensureAllEventsCache(joplin: JoplinLike): Promise<EventInput[]> {
    if (!allEventsCache || lastRebuildFailed) {
        await rebuildAllEventsCache(joplin);
    }
    return allEventsCache || [];
}
