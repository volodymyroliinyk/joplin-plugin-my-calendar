// src/main/types/joplin.interface.ts

export interface Joplin {
    settings: {
        value: (key: string) => Promise<any>;
        setValue: (key: string, value: any) => Promise<void>;
        onChange: (callback: (event: { keys: string[] }) => void) => Promise<void>;
        registerSection: (id: string, options: any) => Promise<void>;
        registerSettings: (settings: any) => Promise<void>;
        settingItemType?: {
            Bool: number;
            String: number;
            Int: number;
        };
    };
    data: {
        get: (path: string[], query?: any) => Promise<any>;
        post: (path: string[], query: any, body: any) => Promise<any>;
        put: (path: string[], query: any, body: any) => Promise<any>;
        delete: (path: string[]) => Promise<void>;
    };
    views: {
        panels: {
            create: (id: string) => Promise<string>;
            setHtml: (panelId: string, html: string) => Promise<void>;
            addScript: (panelId: string, scriptPath: string) => Promise<void>;
            onMessage: (panelId: string, callback: (message: any) => void) => Promise<void>;
            postMessage: (panelId: string, message: any) => Promise<void>;
            show: (panelId: string) => Promise<void>;
            hide: (panelId: string) => Promise<void>;
            focus: (panelId: string) => Promise<void>;
        };
        dialogs: {
            showMessageBox: (message: string) => Promise<void>;
            showToast: (payload: any) => Promise<void>;
        };
        menuItems?: {
            create?: (id: string, commandName: string, location: string, options?: any) => Promise<void>;
        };
        toolbarButtons?: {
            create?: (id: string, commandName: string, location: string) => Promise<void>;
        };
    };
    commands: {
        execute: (command: string, ...args: any[]) => Promise<any>;
        register: (command: any) => Promise<void>;
    };
    workspace?: {
        onNoteChange?: (callback: (event: { id?: string }) => void) => Promise<void>;
        onSyncComplete?: (callback: () => void) => Promise<void>;
    };
    versionInfo: () => Promise<{ platform: string }>;
}
