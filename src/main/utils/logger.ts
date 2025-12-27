// src/main/utils/logger.ts
let debugEnabled = false;

export function setDebugEnabled(v: boolean) {
    debugEnabled = v;
}

export function dbg(...a: any[]) {
    if (debugEnabled) console.log('[MyCalendar]', ...a);
}

export function info(...a: any[]) {
    console.log('[MyCalendar]', ...a);
}

export function warn(...a: any[]) {
    console.warn('[MyCalendar]', ...a);
}

export function err(...a: any[]) {
    console.error('[MyCalendar]', ...a);
}