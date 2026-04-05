// src/main/services/scheduledIcsImportService.ts

import {
    getScheduledIcsImportEntries,
    getScheduledIcsImportIntervalMinutes,
    getIcsImportAlarmRangeDays,
} from '../settings/settings';
import {getAllFolders, resolveFolderIdByTitle} from './folderService';
import {importIcsIntoNotes} from './icsImportService';
import {invalidateAllEventsCache} from './eventsCache';
import {Joplin} from '../types/joplin.interface';
import {dbg, err, log, warn} from '../utils/logger';
import {showToast} from '../utils/toast';
import {getErrorText} from '../utils/errorUtils';

type ImportSummary = {
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
};

export type ScheduledIcsImportController = {
    refresh: () => Promise<void>;
    stop: () => void;
};

type StartOptions = {
    onAfterImport?: (summary: ImportSummary) => Promise<void> | void;
    downloadIcs?: (url: string) => Promise<string>;
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function emptySummary(): ImportSummary {
    return {
        added: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        alarmsCreated: 0,
        alarmsDeleted: 0,
        alarmsUpdated: 0,
    };
}

function mergeSummary(target: ImportSummary, next: ImportSummary): ImportSummary {
    target.added += next.added;
    target.updated += next.updated;
    target.skipped += next.skipped;
    target.errors += next.errors;
    target.alarmsCreated += next.alarmsCreated;
    target.alarmsDeleted += next.alarmsDeleted;
    target.alarmsUpdated += next.alarmsUpdated;
    return target;
}

function isDesktopPlatform(platform: unknown): boolean {
    return String(platform ?? '').toLowerCase() !== 'mobile';
}

function redactUrlFromText(text: string, url: string): string {
    if (!text || !url) return text;
    return text.split(url).join('[redacted]');
}

function buildImportDoneText(notebookTitle: string, result: ImportSummary): string {
    return `Scheduled ICS import finished for ${notebookTitle}: added=${result.added}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}, alarmsCreated=${result.alarmsCreated}, alarmsDeleted=${result.alarmsDeleted}`;
}

async function showScheduledImportDoneToast(notebookTitle: string, result: ImportSummary): Promise<void> {
    const text = buildImportDoneText(notebookTitle, result);
    if (result.errors > 0) {
        await showToast('warning', text, 5000);
        return;
    }
    await showToast('success', text, 5000);
}

async function showScheduledImportErrorToast(notebookTitle: string, message: string): Promise<void> {
    await showToast('error', `Scheduled ICS import failed for ${notebookTitle}: ${message}`, 5000);
}

export async function downloadIcsFromUrl(url: string, redirectsLeft: number = MAX_REDIRECTS): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        throw new Error('Scheduled ICS import supports HTTPS URLs only');
    }

    const https = await import('https');
    const client = https;

    return new Promise<string>((resolve, reject) => {
        const req = client.get(parsed, {
            headers: {
                Accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.1',
                'User-Agent': 'MyCalendar-Joplin-Plugin/scheduled-import',
            },
        }, (res) => {
            const status = res.statusCode ?? 0;
            const location = res.headers.location;

            if (status >= 300 && status < 400 && location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error('Too many redirects while downloading ICS'));
                    return;
                }

                const nextUrl = new URL(location, parsed).toString();
                void downloadIcsFromUrl(nextUrl, redirectsLeft - 1).then(resolve, reject);
                return;
            }

            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`HTTP ${status} while downloading ICS`));
                return;
            }

            let total = 0;
            const chunks: Buffer[] = [];

            res.on('data', (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                total += buf.length;
                if (total > MAX_RESPONSE_BYTES) {
                    req.destroy(new Error('ICS response is too large'));
                    return;
                }
                chunks.push(buf);
            });

            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8').trim();
                if (!text) {
                    reject(new Error('ICS response is empty'));
                    return;
                }
                resolve(text);
            });
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error('ICS request timed out'));
        });

        req.on('error', reject);
    });
}

export async function startScheduledIcsImport(
    joplin: Joplin,
    options: StartOptions = {},
): Promise<ScheduledIcsImportController> {
    let timer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    let running = false;
    let configVersion = 0;

    const clearTimer = () => {
        if (!timer) return;
        clearInterval(timer);
        timer = undefined;
    };

    const isCurrentVersion = (version: number) => !disposed && version === configVersion;

    const runOnce = async (version: number) => {
        if (disposed) return;
        if (!isCurrentVersion(version)) return;
        if (running) {
            dbg('scheduledIcsImport', 'Skip cycle because a previous scheduled import is still running');
            return;
        }

        running = true;
        try {
            const entries = await getScheduledIcsImportEntries(joplin);
            if (!entries.length) return;

            const folders = await getAllFolders(joplin);
            const importAlarmRangeDays = await getIcsImportAlarmRangeDays(joplin);
            const summary = emptySummary();
            let importedAtLeastOne = false;

            for (const entry of entries) {
                const url = entry.url;
                try {
                    if (!isCurrentVersion(version)) return;
                    const {folderId, reason} = resolveFolderIdByTitle(folders, entry.notebookTitle);
                    if (!folderId) {
                        summary.errors += 1;
                        warn('scheduledIcsImport', reason || `Notebook title "${entry.notebookTitle}" is invalid`);
                        if (isCurrentVersion(version)) {
                            const safeReason = reason || 'Notebook title is invalid';
                            warn('scheduledIcsImport', `Scheduled ICS import failed for ${entry.notebookTitle}: ${safeReason}`);
                            await showScheduledImportErrorToast(entry.notebookTitle, safeReason);
                        }
                        continue;
                    }

                    log('scheduledIcsImport', `Downloading ICS from ${url}`);
                    const ics = await (options.downloadIcs ?? downloadIcsFromUrl)(url);
                    if (!isCurrentVersion(version)) return;
                    const result = await importIcsIntoNotes(
                        joplin,
                        ics,
                        async (text: string) => {
                            dbg('scheduledIcsImport', `[${url}] ${text}`);
                        },
                        folderId,
                        true,
                        undefined,
                        importAlarmRangeDays,
                    );
                    importedAtLeastOne = true;
                    mergeSummary(summary, result);
                    log(
                        'scheduledIcsImport',
                        `Imported ${url}: added=${result.added}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}`,
                    );
                    if (isCurrentVersion(version)) {
                        log('scheduledIcsImport', buildImportDoneText(entry.notebookTitle, result));
                        await showScheduledImportDoneToast(entry.notebookTitle, result);
                    }
                } catch (error) {
                    summary.errors += 1;
                    const errText = getErrorText(error);
                    warn('scheduledIcsImport', `Failed to import ${url}:`, error);
                    if (isCurrentVersion(version)) {
                        const safeErrorText = redactUrlFromText(errText, url);
                        warn('scheduledIcsImport', `Scheduled ICS import failed for ${entry.notebookTitle}: ${safeErrorText}`);
                        await showScheduledImportErrorToast(entry.notebookTitle, safeErrorText);
                    }
                }
            }

            if (importedAtLeastOne && isCurrentVersion(version)) {
                invalidateAllEventsCache();
                await options.onAfterImport?.(summary);
            }
        } catch (error) {
            err('scheduledIcsImport', 'Scheduled ICS import cycle failed:', error);
        } finally {
            running = false;
        }
    };

    const refresh = async () => {
        clearTimer();
        if (disposed) return;
        configVersion += 1;
        const version = configVersion;

        const entries = await getScheduledIcsImportEntries(joplin);
        if (!entries.length) {
            log('scheduledIcsImport', 'Scheduled ICS import is disabled because no valid HTTPS URL + notebook title pairs are configured');
            return;
        }

        const minutes = await getScheduledIcsImportIntervalMinutes(joplin);
        timer = setInterval(() => {
            void runOnce(version);
        }, minutes * 60 * 1000);

        log('scheduledIcsImport', `Scheduled ICS import runs every ${minutes} minute(s) for ${entries.length} pair(s)`);
    };

    try {
        if (typeof joplin.versionInfo === 'function') {
            const versionInfo = await joplin.versionInfo();
            if (!isDesktopPlatform(versionInfo?.platform)) {
                log('scheduledIcsImport', 'Scheduled ICS import is disabled on mobile');
                return {
                    refresh,
                    stop: () => {
                        disposed = true;
                        clearTimer();
                    },
                };
            }
        }

        await refresh();
    } catch (error) {
        warn('scheduledIcsImport', 'Unable to detect platform for scheduled ICS import; assuming desktop:', error);
        await refresh();
    }

    return {
        refresh,
        stop: () => {
            disposed = true;
            clearTimer();
        },
    };
}
