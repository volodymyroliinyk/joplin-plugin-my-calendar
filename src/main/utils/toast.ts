// src/main/utils/toast.ts

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export const DEFAULT_TOAST_DURATION_MS = 3000;

type ToastPayload = {
    type: ToastType;
    message: string;
    duration: number;
    timestamp: number;
};

type DialogsLike = {
    showToast(payload: ToastPayload): Promise<void>;
};

function getDialogs(): DialogsLike {
    // Joplin typings can lag, so we're doing a narrow cast here, in one place.
    return (joplin.views.dialogs as unknown) as DialogsLike;
}

export async function showToast(
    type: ToastType,
    message: string,
    duration: number = DEFAULT_TOAST_DURATION_MS
): Promise<void> {
    const dialogs = getDialogs();

    // Easy normalization (does not change test logic and current behavior).
    const safeDuration = Number.isFinite(duration) ? Math.trunc(duration) : DEFAULT_TOAST_DURATION_MS;

    await dialogs.showToast({
        type,
        message,
        duration: safeDuration,
        // timestamp helps if Joplin doesn't show a duplicate of the same toast.
        timestamp: Date.now(),
    });
}
