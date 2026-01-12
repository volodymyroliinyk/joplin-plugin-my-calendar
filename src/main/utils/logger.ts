/**
 * Minimal project logger.
 * Goal: replace direct console.* usage while keeping backwards-compatible output shape
 * for existing tests and diagnostics.
 */
const PREFIX = '[MyCalendar]';

let debugEnabled = false;

export function setDebugEnabled(v: boolean) {
    debugEnabled = v === true;
}

function write(
    consoleFn: (...args: any[]) => void,
    args: any[],
) {
    if (args.length > 0 && typeof args[0] === 'string') {
        const [msg, ...rest] = args;
        // Keep single-string prefix for string-first logs (many tests assert this).
        consoleFn(`${PREFIX} ${msg}`, ...rest);
        return;
    }
    // Non-string first arg: keep prefix as separate argument.
    consoleFn(PREFIX, ...args);
}

export function log(...a: any[]) {
    write(console.log, a);
}

export function info(...a: any[]) {
    write(console.info, a);
}

export function warn(...a: any[]) {
    write(console.warn, a);
}

export function err(...a: any[]) {
    write(console.error, a);
}

export function dbg(...a: any[]) {
    if (!debugEnabled) return;
    write(console.debug, a);
}
