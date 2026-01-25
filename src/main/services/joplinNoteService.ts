// src/main/services/joplinNoteService.ts

import {Joplin} from '../types/joplin.interface';

export interface NoteItem {
    id: string;
    title: string;
    body: string;
    parent_id?: string;
    is_todo?: number;
    todo_due?: number;
}

export async function getAllNotesPaged(
    joplin: Joplin,
    fields: string[] = ['id', 'title', 'body', 'parent_id']
): Promise<NoteItem[]> {
    const allNotes: NoteItem[] = [];
    let page = 1;
    while (true) {
        const res = await joplin.data.get(['notes'], {fields, limit: 100, page});
        allNotes.push(...(res.items || []));
        if (!res.has_more) break;
        page++;
    }
    return allNotes;
}

export async function createNote(joplin: Joplin, note: Partial<NoteItem>): Promise<NoteItem> {
    return await joplin.data.post(['notes'], null, note);
}

export async function updateNote(joplin: Joplin, id: string, patch: Partial<NoteItem>): Promise<void> {
    await joplin.data.put(['notes', id], null, patch);
}

export async function deleteNote(joplin: Joplin, id: string): Promise<void> {
    await joplin.data.delete(['notes', id]);
}
