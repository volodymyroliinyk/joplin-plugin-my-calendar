// src/main/services/folderService.ts

import {Joplin} from '../types/joplin.interface';

export type FolderRow = { id: string; title: string; parent_id?: string | null };
type FolderNode = { id: string; title: string; parent_id: string | null; children: FolderNode[] };
export type FolderOption = { id: string; title: string; parent_id: string | null; depth: number };

const FOLDERS_PAGE_LIMIT = 100;

export async function getAllFolders(joplin: Joplin): Promise<FolderRow[]> {
    const out: FolderRow[] = [];
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['folders'], {
            page,
            limit: FOLDERS_PAGE_LIMIT,
            fields: ['id', 'title', 'parent_id'],
        });

        const items = (res?.items ?? []) as FolderRow[];
        if (items.length) out.push(...items);

        if (!res?.has_more) break;
        page += 1;
    }

    return out;
}

/**
 * Flattens a folder graph into a depth-annotated list.
 *
 * Notes:
 * - Ordering is deterministic (case-insensitive alphabetical).
 * - Orphans are treated as roots.
 * - Cycles are handled: items involved in cycles are still included, and traversal stops on cycle edges.
 */
export function flattenFolderTree(rows: FolderRow[]): FolderOption[] {
    const byId = new Map<string, FolderNode>();

    // Build nodes; normalize parent_id to null to avoid undefined / null differences.
    for (const r of rows) {
        byId.set(r.id, {id: r.id, title: r.title, parent_id: r.parent_id ?? null, children: []});
    }

    const roots: FolderNode[] = [];
    // Link children -> parents when possible, otherwise treat as root.
    for (const node of byId.values()) {
        const parentId = node.parent_id;
        if (parentId && byId.has(parentId) && parentId !== node.id) {
            byId.get(parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const sortFn = (a: Pick<FolderNode, 'title'>, b: Pick<FolderNode, 'title'>) =>
        a.title.localeCompare(b.title, undefined, {sensitivity: 'base'});

    roots.sort(sortFn);

    const acc: FolderOption[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (node: FolderNode, depth: number) => {
        if (visited.has(node.id)) return;

        // Cycle edge: stop descent (the node is already in the current path).
        if (visiting.has(node.id)) return;

        visiting.add(node.id);
        acc.push({id: node.id, title: node.title, parent_id: node.parent_id, depth});

        node.children.sort(sortFn);
        for (const ch of node.children) visit(ch, depth + 1);

        visiting.delete(node.id);
        visited.add(node.id);
    };

    // Walk declared roots first.
    for (const r of roots) visit(r, 0);

    // Include any remaining nodes (covers pure cycles and disconnected graphs with no roots).
    if (visited.size !== byId.size) {
        const remaining = Array.from(byId.values()).filter(n => !visited.has(n.id));
        remaining.sort(sortFn);
        for (const n of remaining) visit(n, 0);
    }

    return acc;
}
