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

export interface TagItem {
    id: string;
    title: string;
}

interface PagedResponse<T> {
    items?: T[];
    has_more?: boolean;
}

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 1000;

async function getPagedItems<T>(
    joplin: Joplin,
    path: string[],
    fields: string[],
    options: { limit?: number; maxPages?: number } = {},
    errorLabel = 'getPagedItems',
): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;
    const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

    while (true) {
        if (page > maxPages) {
            throw new Error(`${errorLabel} exceeded maxPages=${maxPages}`);
        }
        const res = (await joplin.data.get(path, {fields, limit, page})) as PagedResponse<T>;
        allItems.push(...(res.items ?? []));
        if (!res.has_more) break;
        page++;
    }
    return allItems;
}

async function getPagedNotes(
    joplin: Joplin,
    path: string[],
    fields: string[] = ['id', 'title', 'body', 'parent_id'],
    options: { limit?: number; maxPages?: number } = {}
): Promise<NoteItem[]> {
    return getPagedItems<NoteItem>(joplin, path, fields, options, 'getPagedNotes');
}

export async function getAllNotesPaged(
    joplin: Joplin,
    fields: string[] = ['id', 'title', 'body', 'parent_id'],
    options: { limit?: number; maxPages?: number } = {}
): Promise<NoteItem[]> {
    return getPagedNotes(joplin, ['notes'], fields, options);
}

export async function getFolderNotesPaged(
    joplin: Joplin,
    folderId: string,
    fields: string[] = ['id', 'title', 'body', 'parent_id'],
    options: { limit?: number; maxPages?: number } = {}
): Promise<NoteItem[]> {
    return getPagedNotes(joplin, ['folders', folderId, 'notes'], fields, options);
}

export async function createNote(joplin: Joplin, note: Partial<NoteItem>): Promise<NoteItem> {
    return joplin.data.post(['notes'], null, note);
}

export async function getAllTagsPaged(
    joplin: Joplin,
    fields: string[] = ['id', 'title'],
    options: { limit?: number; maxPages?: number } = {}
): Promise<TagItem[]> {
    return getPagedItems<TagItem>(joplin, ['tags'], fields, options);
}

export async function attachTagToNote(joplin: Joplin, tagId: string, noteId: string): Promise<void> {
    await joplin.data.post(['tags', tagId, 'notes'], null, {id: noteId});
}

export async function updateNote(joplin: Joplin, id: string, patch: Partial<NoteItem>): Promise<void> {
    await joplin.data.put(['notes', id], null, patch);
}

export async function deleteNote(joplin: Joplin, id: string): Promise<void> {
    await joplin.data.delete(['notes', id]);
}
