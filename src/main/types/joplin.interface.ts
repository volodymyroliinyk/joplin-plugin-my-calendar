// src/main/types/joplin.interface.ts

export interface Joplin {
    settings: {
        value: (key: string) => Promise<any>;
        setValue: (key: string, value: any) => Promise<void>;
        onChange: (callback: (event: { keys: string[] }) => void) => Promise<void>;
        registerSection: (id: string, options: any) => Promise<void>;
        registerSettings: (settings: any) => Promise<void>;
    };
    data: {
        get: (path: string[], query?: any) => Promise<any>;
        post: (path: string[], query: any, body: any) => Promise<any>;
        put: (path: string[], query: any, body: any) => Promise<any>;
        delete: (path: string[]) => Promise<void>;
    };
    views: {
        panels: {
            onMessage: (panelId: string, callback: (message: any) => void) => Promise<void>;
            postMessage: (panelId: string, message: any) => Promise<void>;
            focus: (panelId: string) => Promise<void>;
        };
        dialogs: {
            showMessageBox: (message: string) => Promise<void>;
            showToast: (payload: any) => Promise<void>;
        };
    };
    commands: {
        execute: (command: string, ...args: any[]) => Promise<any>;
    };
    versionInfo: () => Promise<{ platform: string }>;
}
