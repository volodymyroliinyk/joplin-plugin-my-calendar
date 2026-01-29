// src/main/utils/logger.ts
/**
 * Minimal console logger with a fixed prefix.
 *
 * Design goals:
 * - Keep current runtime behavior (string-first vs non-string-first arguments).
 * - Keep public API stable for existing imports/tests.
 * - Avoid `any` in public surface; prefer `unknown`.
 */

const PREFIX = '[MyCalendar]';

let debugEnabled = false;

export function setDebugEnabled(v: boolean): void {
    debugEnabled = Boolean(v);
}

type ConsoleFn = (...args: unknown[]) => void;

function buildArgs(source: string, args: readonly unknown[]): unknown[] {
    const sourcePrefix = source ? `[${source}]` : '';

    if (args.length > 0 && typeof args[0] === 'string') {
        const [msg, ...rest] = args as readonly [string, ...unknown[]];
        return [`${PREFIX}${sourcePrefix} ${msg}`, ...rest];
    }

    return [PREFIX + sourcePrefix, ...args];
}

function write(consoleFn: ConsoleFn, source: string, args: readonly unknown[]): void {
    consoleFn(...buildArgs(source, args));
}

export function log(source: string, ...args: unknown[]): void {
    write(console.log, source, args);
}

export function info(source: string, ...args: unknown[]): void {
    write(console.info, source, args);
}

export function warn(source: string, ...args: unknown[]): void {
    write(console.warn, source, args);
}

/** Prefer `err` for backward-compatibility with existing code. */
export function err(source: string, ...args: unknown[]): void {
    write(console.error, source, args);
}

/** Debug log (enabled via `setDebugEnabled(true)`). */
export function dbg(source: string, ...args: unknown[]): void {
    if (!debugEnabled) return;
    write(console.log, source, args);
}
