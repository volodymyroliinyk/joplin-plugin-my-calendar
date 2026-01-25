// tests/services/folderService.test.ts

import {
    flattenFolderTree,
    FolderRow
} from '../../src/main/services/folderService';

describe('folderService', () => {

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

        test('handles orphans as roots', () => {
            const rows: FolderRow[] = [
                {id: 'child', title: 'Child', parent_id: 'non-existent'}
            ];
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
    });
});
