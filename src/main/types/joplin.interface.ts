// src/main/types/joplin.interface.ts

export interface Joplin {
    settings: {
        value: (key: string) => Promise<any>;
        setValue: (key: string, value: unknown) => Promise<void>;
        onChange: (callback: (event: { keys: string[] }) => void) => Promise<void>;
        registerSection: (id: string, options: Record<string, unknown>) => Promise<void>;
        registerSettings: (settings: Record<string, unknown>) => Promise<void>;
        settingItemType?: {
            Bool: number;
            String: number;
            Int: number;
        };
    };
    data: {
        get: (path: string[], query?: unknown) => Promise<any>;
        post: (path: string[], query: unknown, body: unknown) => Promise<any>;
        put: (path: string[], query: unknown, body: unknown) => Promise<any>;
        delete: (path: string[]) => Promise<void>;
    };
    views: {
        panels: {
            create: (id: string) => Promise<string>;
            setHtml: (panelId: string, html: string) => Promise<void>;
            addScript: (panelId: string, scriptPath: string) => Promise<void>;
            onMessage: (panelId: string, callback: (message: unknown) => void) => Promise<void>;
            postMessage: (panelId: string, message: unknown) => Promise<void>;
            show: (panelId: string, visible?: boolean) => Promise<void>;
            hide?: (panelId: string) => Promise<void>;
            visible?: (panelId: string) => Promise<boolean>;
            focus?: (panelId: string) => Promise<void>;
        };
        dialogs: {
            showToast: (payload: unknown) => Promise<void>;
        };
        menuItems?: {
            create?: (id: string, commandName: string, location: string, options?: Record<string, unknown>) => Promise<void>;
        };
        toolbarButtons?: {
            create?: (id: string, commandName: string, location: string) => Promise<void>;
        };
    };
    commands: {
        execute: (command: string, ...args: unknown[]) => Promise<any>;
        register: (command: Record<string, unknown>) => Promise<void>;
    };
    workspace?: {
        onNoteChange?: (callback: (event: { id?: string }) => void) => Promise<void>;
        onSyncComplete?: (callback: () => void) => Promise<void>;
    };
    versionInfo: () => Promise<{ platform: string }>;
}
