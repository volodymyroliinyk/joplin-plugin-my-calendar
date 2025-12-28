// src/types/global-joplin.d.ts

declare global {
    // eslint-disable-next-line no-var
    var joplin: any;

    interface Window {
        joplin?: any;
    }
}
export {};
