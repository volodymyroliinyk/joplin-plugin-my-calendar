// src/main/services/eventsCache.ts
import {parseEventsFromBody, EventInput} from '../../eventParser';

const eventCacheByNote = new Map<string, EventInput[]>();
let allEventsCache: EventInput[] | null = null;
let rebuilding = false;

export function invalidateAllEventsCache() {
    allEventsCache = null;
}

export function invalidateNote(noteId: string) {
    eventCacheByNote.delete(noteId);
    allEventsCache = null;
}

export async function rebuildAllEventsCache(joplin: any) {
    if (rebuilding) return;
    rebuilding = true;

    try {
        console.log('[MyCalendar] rebuildAllEventsCache: start');
        const fields = ['id', 'title', 'body'];
        const items: any[] = [];
        let page = 1;

        eventCacheByNote.clear();

        while (true) {
            const res = await joplin.data.get(['notes'], {fields, limit: 100, page});
            for (const n of res.items || []) items.push(n);
            if (!res.has_more) break;
            page++;
        }

        const all: EventInput[] = [];

        for (const n of items) showNote:
        {
            const id = String(n.id || '');
            const body = typeof n.body === 'string' ? n.body : '';
            if (!id || !body) break showNote;

            // витягуємо лише наші блоки
            const evs = parseEventsFromBody(
                String(n.id || ''),
                String(n.title || ''),
                body
            ) || [];
            if (!evs.length) break showNote;

            eventCacheByNote.set(id, evs);

            for (const e of evs) {
                // збережемо noteId, щоб UI міг відкрити нотатку
                (e as any).noteId = id;
                all.push(e);
            }
        }

        allEventsCache = all;
        console.log('[MyCalendar] rebuildAllEventsCache: done events=', allEventsCache.length);
    } catch (err) {
        console.error('[MyCalendar] rebuildAllEventsCache: error', err);
        // щоб не залипало у rebuilding=true
        allEventsCache = allEventsCache || [];
    } finally {
        rebuilding = false;
    }
}

export async function ensureAllEventsCache(joplin: any) {
    if (!allEventsCache) {
        await rebuildAllEventsCache(joplin);
    }
    return allEventsCache!;
}
