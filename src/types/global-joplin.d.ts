// src/types/global-joplin.d.ts

declare global {

    const joplin: any;

    interface Window {
        joplin?: any;
    }
}
export {};
