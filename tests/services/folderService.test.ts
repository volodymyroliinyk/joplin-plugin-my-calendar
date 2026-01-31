// tests/services/folderService.test.ts
//
// src/main/services/folderService.ts
//
// npx jest tests/services/folderService.test.ts --runInBand --no-cache;
//
import {flattenFolderTree, getAllFolders, FolderRow} from '../../src/main/services/folderService';

describe('folderService', () => {
    describe('getAllFolders', () => {
        test('returns all folders from a single page', async () => {
            const joplin = {
                data: {
                    get: jest.fn().mockResolvedValue({
                        items: [{id: '1', title: 'A', parent_id: null}],
                        has_more: false,
                    }),
                },
            } as any;

            const rows = await getAllFolders(joplin);

            expect(rows).toEqual([{id: '1', title: 'A', parent_id: null}]);
            expect(joplin.data.get).toHaveBeenCalledTimes(1);
            expect(joplin.data.get).toHaveBeenCalledWith(['folders'], {
                page: 1,
                limit: 100,
                fields: ['id', 'title', 'parent_id'],
            });
        });

        test('paginates until has_more is false', async () => {
            const joplin = {
                data: {
                    get: jest
                        .fn()
                        .mockResolvedValueOnce({
                            items: [{id: '1', title: 'A', parent_id: null}],
                            has_more: true,
                        })
                        .mockResolvedValueOnce({
                            items: [{id: '2', title: 'B', parent_id: null}],
                            has_more: false,
                        }),
                },
            } as any;

            const rows = await getAllFolders(joplin);

            expect(rows.map(r => r.id)).toEqual(['1', '2']);
            expect(joplin.data.get).toHaveBeenCalledTimes(2);

            expect(joplin.data.get.mock.calls[0][1].page).toBe(1);
            expect(joplin.data.get.mock.calls[1][1].page).toBe(2);
        });

        test('handles empty pages safely', async () => {
            const joplin = {
                data: {
                    get: jest.fn().mockResolvedValue({
                        items: undefined,
                        has_more: false,
                    }),
                },
            } as any;

            const rows = await getAllFolders(joplin);
            expect(rows).toEqual([]);
        });
    });
    describe('flattenFolderTree', () => {
        test('sorts roots alphabetically and preserves structure', () => {
            const rows: FolderRow[] = [
                {id: 'b', title: 'B'},
                {id: 'a', title: 'A'},
                {id: 'c', title: 'ChildOfA', parent_id: 'a'},
            ];

            const flat = flattenFolderTree(rows);

            expect(flat[0].id).toBe('a');
            expect(flat[0].depth).toBe(0);
            expect(flat[1].id).toBe('c');
            expect(flat[1].depth).toBe(1);
            expect(flat[2].id).toBe('b');
            expect(flat[2].depth).toBe(0);
        });

        test('sorts children alphabetically (case-insensitive)', () => {
            const rows: FolderRow[] = [
                {id: 'root', title: 'Root'},
                {id: 'b', title: 'b', parent_id: 'root'},
                {id: 'a', title: 'A', parent_id: 'root'},
            ];

            const flat = flattenFolderTree(rows);
            const childIds = flat.filter(x => x.depth === 1).map(x => x.id);
            expect(childIds).toEqual(['a', 'b']);
        });

        test('normalizes missing parent_id to null in output', () => {
            const rows: FolderRow[] = [{id: 'x', title: 'X', parent_id: undefined}];
            const flat = flattenFolderTree(rows);
            expect(flat[0].parent_id).toBeNull();
        });

        test('handles orphans as roots', () => {
            const rows: FolderRow[] = [{id: 'child', title: 'Child', parent_id: 'non-existent'}];

            const flat = flattenFolderTree(rows);
            expect(flat).toHaveLength(1);
            expect(flat[0].id).toBe('child');
            expect(flat[0].depth).toBe(0);
        });

        test('handles deep nesting', () => {
            const rows: FolderRow[] = [
                {id: '1', title: 'Root'},
                {id: '2', title: 'Level1', parent_id: '1'},
                {id: '3', title: 'Level2', parent_id: '2'},
            ];
            const flat = flattenFolderTree(rows);
            expect(flat[0].depth).toBe(0);
            expect(flat[1].depth).toBe(1);
            expect(flat[2].depth).toBe(2);
        });

        test('includes nodes even when there are only cycles', () => {
            const rows: FolderRow[] = [
                {id: 'a', title: 'A', parent_id: 'b'},
                {id: 'b', title: 'B', parent_id: 'a'},
            ];

            const flat = flattenFolderTree(rows);

            expect(flat.map(x => x.id).sort()).toEqual(['a', 'b']);
            // Cycle nodes are treated as roots when no true root exists.
            expect(flat.every(x => x.depth === 0 || x.depth === 1)).toBe(true);
        });

        test('returns empty array for empty input', () => {
            expect(flattenFolderTree([])).toEqual([]);
        });
    });
});
