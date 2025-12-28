// src/main/uiBridge/panelMessages.ts

export type UiToPluginMessage =
    | { name: 'requestRangeEvents'; start: string; end: string }
    | { name: 'icalImport'; mode: 'text'; ics: string; source?: string }
    | { name: 'selectDay'; day: string };

export type PluginToUiMessage =
    | { name: 'rangeEvents'; start: string; end: string; events: any[] }
    | { name: 'importStatus'; text: string }
    | { name: 'importDone'; added: number; updated: number; skipped: number; errors: any[] }
    | { name: 'importError'; error: string };
