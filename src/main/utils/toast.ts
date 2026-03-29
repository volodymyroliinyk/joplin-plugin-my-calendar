// src/main/utils/toast.ts

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export const DEFAULT_TOAST_DURATION_MS = 3000;
const TOAST_DEDUPE_BUFFER_MS = 1000;

type ToastPayload = {
    type: ToastType;
    message: string;
    duration: number;
};

type DialogsLike = {
    showToast(payload: ToastPayload): Promise<void>;
};

let lastToastKey = '';
let lastToastExpiresAt = 0;

function getDialogs(): DialogsLike {
    // Joplin typings can lag, so we're doing a narrow cast here, in one place.
    return (joplin.views.dialogs as unknown) as DialogsLike;
}

function buildToastKey(type: ToastType, message: string): string {
    return `${type}\n${message}`;
}

function isDuplicateToast(type: ToastType, message: string, now: number): boolean {
    return lastToastKey === buildToastKey(type, message) && now < lastToastExpiresAt;
}

function rememberToast(type: ToastType, message: string, duration: number, now: number): void {
    lastToastKey = buildToastKey(type, message);
    lastToastExpiresAt = now + Math.max(0, duration) + TOAST_DEDUPE_BUFFER_MS;
}

export function clearToastCache(): void {
    lastToastKey = '';
    lastToastExpiresAt = 0;
}

export function __resetToastCacheForTests(): void {
    clearToastCache();
}

export async function showToast(
    type: ToastType,
    message: string,
    duration: number = DEFAULT_TOAST_DURATION_MS
): Promise<void> {
    const dialogs = getDialogs();

    // Easy normalization (does not change test logic and current behavior).
    const safeDuration = Number.isFinite(duration) ? Math.trunc(duration) : DEFAULT_TOAST_DURATION_MS;
    const now = Date.now();
    if (isDuplicateToast(type, message, now)) return;

    await dialogs.showToast({
        type,
        message,
        duration: safeDuration,
    });
    rememberToast(type, message, safeDuration, now);
}
