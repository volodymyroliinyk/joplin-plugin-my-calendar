export function getErrorText(error: unknown): string {
    return String((error as { message?: string })?.message || error);
}
