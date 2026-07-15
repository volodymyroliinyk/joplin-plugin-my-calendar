export async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    const workerCount = Math.min(Math.max(1, Math.trunc(concurrency) || 1), items.length);
    let nextIndex = 0;

    const consume = async (): Promise<void> => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) return;
            await worker(items[currentIndex], currentIndex);
        }
    };

    await Promise.all(Array.from({length: workerCount}, consume));
}
