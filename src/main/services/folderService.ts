// src/main/services/folderService.ts

import {Joplin} from '../types/joplin.interface';

export type FolderRow = { id: string; title: string; parent_id?: string | null };
type FolderNode = FolderRow & { children: FolderNode[] };
export type FolderOption = { id: string; title: string; parent_id?: string | null; depth: number };

export async function getAllFolders(joplin: Joplin): Promise<FolderRow[]> {
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

export function flattenFolderTree(rows: FolderRow[]): FolderOption[] {
    const byId = new Map<string, FolderNode>();

    for (const r of rows) {
        byId.set(r.id, {...r, parent_id: r.parent_id ?? null, children: []});
    }

    const roots: FolderNode[] = [];

    for (const node of byId.values()) {
        const parentId = node.parent_id ?? null;
        if (parentId && byId.has(parentId)) {
            byId.get(parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const sortFn = (a: FolderRow, b: FolderRow) =>
        a.title.localeCompare(b.title, undefined, {sensitivity: 'base'});

    const walk = (node: FolderNode, depth: number, acc: FolderOption[]) => {
        acc.push({id: node.id, title: node.title, parent_id: node.parent_id ?? null, depth});

        node.children.sort(sortFn);
        for (const ch of node.children) walk(ch, depth + 1, acc);
    };

    roots.sort(sortFn);

    const acc: FolderOption[] = [];
    for (const r of roots) walk(r, 0, acc);

    return acc;
}
