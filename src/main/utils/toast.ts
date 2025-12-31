// src/main/utils/toast.ts

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export async function showToast(
    type: ToastType,
    message: string,
    duration = 3000
) {
    // showToast є в joplin.views.dialogs, але TypeScript typings інколи відстають,
    // тому використовуємо "as any".
    const dialogs = joplin.views.dialogs as any;

    await dialogs.showToast({
        type,
        message,
        duration,
        // timestamp допомагає, якщо однакові тости не показуються повторно
        // (Joplin може ігнорувати повтор з тим же message/duration/type).
        timestamp: Date.now(),
    });
}
