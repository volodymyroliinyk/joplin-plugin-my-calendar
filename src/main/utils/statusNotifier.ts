export type AsyncTextHandler = (text: string) => Promise<void> | void;

export function createSafeTextReporter(onStatus?: AsyncTextHandler) {
    return async (text: string): Promise<void> => {
        try {
            await onStatus?.(text);
        } catch {
            // Ignore status reporting failures because they should never break the import flow.
        }
    };
}
