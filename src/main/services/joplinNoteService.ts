// src/main/services/joplinNoteService.ts

import {Joplin} from '../types/joplin.interface';

export interface NoteItem {
    id: string;
    title: string;
    body: string;
    parent_id?: string;
    is_todo?: number;
    todo_due?: number;
    todo_completed?: number;
}

interface PagedResponse<T> {
    items?: T[];
    has_more?: boolean;
}

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 1000;

export async function getAllNotesPaged(
    joplin: Joplin,
    fields: string[] = ['id', 'title', 'body', 'parent_id'],
    options: { limit?: number; maxPages?: number } = {}
): Promise<NoteItem[]> {
    const allNotes: NoteItem[] = [];
    let page = 1;
    const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

    while (true) {
        if (page > maxPages) {
            throw new Error(`getAllNotesPaged exceeded maxPages=${maxPages}`);
        }
        const res = (await joplin.data.get(['notes'], {fields, limit, page})) as PagedResponse<NoteItem>;
        allNotes.push(...(res.items ?? []));
        if (!res.has_more) break;
        page++;
    }
    return allNotes;
}

export async function createNote(joplin: Joplin, note: Partial<NoteItem>): Promise<NoteItem> {
    return joplin.data.post(['notes'], null, note);
}

export async function updateNote(joplin: Joplin, id: string, patch: Partial<NoteItem>): Promise<void> {
    await joplin.data.put(['notes', id], null, patch);
}

export async function deleteNote(joplin: Joplin, id: string): Promise<void> {
    await joplin.data.delete(['notes', id]);
}
