// src/main/utils/toast.ts

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export async function showToast(
    type: ToastType,
    message: string,
    duration = 3000
) {
    // showToast is in joplin.views.dialogs, but TypeScript typings sometimes lag,
    // so we use "as any".
    const dialogs = joplin.views.dialogs as any;

    await dialogs.showToast({
        type,
        message,
        duration,
        // timestamp helps if identical toasts are not shown repeatedly
        // (Joplin can ignore a repeat with the same message/duration/type).
        timestamp: Date.now(),
    });
}
