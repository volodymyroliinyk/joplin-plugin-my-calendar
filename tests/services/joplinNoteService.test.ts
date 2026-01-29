import {deleteNote} from '../../src/main/services/joplinNoteService';
import {Joplin} from '../../src/main/types/joplin.interface';

describe('joplinNoteService', () => {
    let mockJoplin: Joplin;

    beforeEach(() => {
        mockJoplin = {
            data: {
                delete: jest.fn(),
            },
            commands: {
                execute: jest.fn(),
            }
        } as unknown as Joplin;
    });

    describe('deleteNote', () => {
        it('should delete via data API', async () => {
            await deleteNote(mockJoplin, 'note1');
            expect(mockJoplin.data.delete).toHaveBeenCalledWith(['notes', 'note1']);
        });
    });
});
