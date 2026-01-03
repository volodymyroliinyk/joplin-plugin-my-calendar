// src/types/global-joplin.d.ts

declare global {
    // eslint-disable-next-line no-var
    const joplin: any;

    interface Window {
        joplin?: any;
    }
}
export {};
