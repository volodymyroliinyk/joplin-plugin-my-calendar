// tests/services/joplinNoteService.test.ts
//
// src/main/services/joplinNoteService.ts
//
// npx jest tests/services/joplinNoteService.test.ts --runInBand --no-cache;
//
import {deleteNote} from '../../src/main/services/joplinNoteService';
import {createNote, getAllNotesPaged, updateNote} from '../../src/main/services/joplinNoteService';
import {Joplin} from '../../src/main/types/joplin.interface';

describe('joplinNoteService', () => {
    let mockJoplin: Joplin;

    beforeEach(() => {
        mockJoplin = {
            data: {
                get: jest.fn(),
                post: jest.fn(),
                put: jest.fn(),
                delete: jest.fn(),
            },
            commands: {
                execute: jest.fn(),
            }
        } as unknown as Joplin;
    });

    describe('getAllNotesPaged', () => {
        it('should return notes from a single page', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValueOnce({
                items: [{id: '1', title: 't1', body: 'b1', parent_id: 'p1'}],
                has_more: false,
            });

            const res = await getAllNotesPaged(mockJoplin);

            expect(res).toEqual([{id: '1', title: 't1', body: 'b1', parent_id: 'p1'}]);
            expect(mockJoplin.data.get).toHaveBeenCalledWith(
                ['notes'],
                {fields: ['id', 'title', 'body', 'parent_id'], limit: 100, page: 1}
            );
        });

        it('should paginate and concatenate results', async () => {
            (mockJoplin.data.get as jest.Mock)
                .mockResolvedValueOnce({
                    items: [{id: '1', title: 't1', body: 'b1', parent_id: 'p1'}],
                    has_more: true,
                })
                .mockResolvedValueOnce({
                    items: [{id: '2', title: 't2', body: 'b2', parent_id: 'p2'}],
                    has_more: false,
                });

            const res = await getAllNotesPaged(mockJoplin);

            expect(res).toEqual([
                {id: '1', title: 't1', body: 'b1', parent_id: 'p1'},
                {id: '2', title: 't2', body: 'b2', parent_id: 'p2'},
            ]);

            expect(mockJoplin.data.get).toHaveBeenNthCalledWith(
                1,
                ['notes'],
                {fields: ['id', 'title', 'body', 'parent_id'], limit: 100, page: 1}
            );
            expect(mockJoplin.data.get).toHaveBeenNthCalledWith(
                2,
                ['notes'],
                {fields: ['id', 'title', 'body', 'parent_id'], limit: 100, page: 2}
            );
        });

        it('should handle undefined items as empty array', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValueOnce({
                items: undefined,
                has_more: false,
            });

            const res = await getAllNotesPaged(mockJoplin);
            expect(res).toEqual([]);
        });

        it('should throw if maxPages exceeded', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValue({
                items: [],
                has_more: true,
            });

            await expect(getAllNotesPaged(mockJoplin, ['id'], {maxPages: 2})).rejects.toThrow(
                'getAllNotesPaged exceeded maxPages=2'
            );
        });
    });

    describe('createNote', () => {
        it('should create via data API and return created note', async () => {
            (mockJoplin.data.post as jest.Mock).mockResolvedValueOnce({
                id: 'n1',
                title: 'hello',
                body: 'world',
                parent_id: 'p1',
            });

            const res = await createNote(mockJoplin, {title: 'hello', body: 'world'});

            expect(mockJoplin.data.post).toHaveBeenCalledWith(['notes'], null, {title: 'hello', body: 'world'});
            expect(res).toEqual({id: 'n1', title: 'hello', body: 'world', parent_id: 'p1'});
        });
    });

    describe('updateNote', () => {
        it('should update via data API', async () => {
            (mockJoplin.data.put as jest.Mock).mockResolvedValueOnce(undefined);

            await updateNote(mockJoplin, 'note1', {title: 'new'});

            expect(mockJoplin.data.put).toHaveBeenCalledWith(['notes', 'note1'], null, {title: 'new'});
        });
    });
    describe('deleteNote', () => {
        it('should delete via data API', async () => {
            await deleteNote(mockJoplin, 'note1');
            expect(mockJoplin.data.delete).toHaveBeenCalledWith(['notes', 'note1']);
        });
    });
});
