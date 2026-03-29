// src/main/services/folderService.ts

import {Joplin} from '../types/joplin.interface';

export type FolderRow = { id: string; title: string; parent_id?: string | null };
type FolderNode = { id: string; title: string; parent_id: string | null; children: FolderNode[] };
export type FolderOption = { id: string; title: string; parent_id: string | null; depth: number };
export type FolderPathOption = FolderOption & { pathTitle: string };

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

export function buildFolderPathOptions(rows: FolderRow[]): FolderPathOption[] {
    const flat = flattenFolderTree(rows);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const cache = new Map<string, string>();

    const buildPathTitle = (id: string, visiting: Set<string> = new Set()): string => {
        const cached = cache.get(id);
        if (cached) return cached;

        const row = byId.get(id);
        if (!row) return '';
        if (visiting.has(id)) return row.title;

        visiting.add(id);
        const parentId = row.parent_id ?? null;
        const pathTitle = parentId && byId.has(parentId)
            ? `${buildPathTitle(parentId, visiting)} / ${row.title}`
            : row.title;
        visiting.delete(id);
        cache.set(id, pathTitle);
        return pathTitle;
    };

    return flat.map((item) => ({
        ...item,
        pathTitle: buildPathTitle(item.id),
    }));
}

export function resolveFolderIdByTitle(rows: FolderRow[], requestedTitle: string): {
    folderId?: string;
    reason?: string
} {
    const safeTitle = String(requestedTitle ?? '').trim().toLowerCase();
    if (!safeTitle) return {reason: 'Notebook title is empty'};

    const options = buildFolderPathOptions(rows);
    const pathMatches = options.filter((item) => item.pathTitle.trim().toLowerCase() === safeTitle);
    if (pathMatches.length === 1) return {folderId: pathMatches[0].id};
    if (pathMatches.length > 1) return {reason: `Notebook title "${requestedTitle}" is ambiguous`};

    const titleMatches = options.filter((item) => item.title.trim().toLowerCase() === safeTitle);
    if (titleMatches.length === 1) return {folderId: titleMatches[0].id};
    if (titleMatches.length > 1) return {reason: `Notebook title "${requestedTitle}" is ambiguous`};

    return {reason: `Notebook title "${requestedTitle}" was not found`};
}
