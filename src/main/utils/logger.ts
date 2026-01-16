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

function buildArgs(args: readonly unknown[]): unknown[] {
    if (args.length > 0 && typeof args[0] === 'string') {
        const [msg, ...rest] = args as readonly [string, ...unknown[]];
        // Keep single-string prefix for string-first logs (tests assert this shape).
        return [`${PREFIX} ${msg}`, ...rest];
    }

    // Non-string first arg: keep prefix as a separate argument.
    return [PREFIX, ...args];
}

function write(consoleFn: ConsoleFn, args: readonly unknown[]): void {
    consoleFn(...buildArgs(args));
}

export function log(...args: unknown[]): void {
    write(console.log, args);
}

export function info(...args: unknown[]): void {
    write(console.info, args);
}

export function warn(...args: unknown[]): void {
    write(console.warn, args);
}

/** Prefer `err` for backward-compatibility with existing code. */
export function err(...args: unknown[]): void {
    write(console.error, args);
}

/** Debug log (enabled via `setDebugEnabled(true)`). */
export function dbg(...args: unknown[]): void {
    if (!debugEnabled) return;
    // Keep console.log to preserve existing behavior/tests.
    write(console.log, args);
}
