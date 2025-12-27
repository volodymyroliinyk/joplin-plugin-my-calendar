// src/main/services/icsImportService.ts

type IcsEvent = {
    uid?: string;
    summary?: string;
    description?: string;
    dtstart?: string;
    dtend?: string;
    rrule?: string;
    tzid?: string;
    color?: string;
    location?: string;
};

function unfoldIcsLines(ics: string): string[] {
    const raw = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out: string[] = [];
    for (const line of raw) {
        if (!line) continue;
        // folded line: starts with space/tab
        if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }
    return out;
}

function unescapeIcsText(s: string): string {
    return s
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

// беремо значення після ":" (ігноруємо параметри типу DTSTART;TZID=...)
function parseLineValue(line: string): { key: string; value: string } | null {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const left = line.slice(0, i);
    const value = line.slice(i + 1);
    const key = left.split(';')[0].trim().toUpperCase();
    return {key, value};
}

function parseIcs(ics: string): IcsEvent[] {
    const lines = unfoldIcsLines(ics);
    const events: IcsEvent[] = [];
    let cur: IcsEvent | null = null;

    for (const line of lines) {
        const L = line.trim();
        if (!L) continue;

        if (L === 'BEGIN:VEVENT') {
            cur = {};
            continue;
        }
        if (L === 'END:VEVENT') {
            if (cur) events.push(cur);
            cur = null;
            continue;
        }
        if (!cur) continue;

        const parsed = parseLineValue(L);
        if (!parsed) continue;

        const {key, value} = parsed;

        if (key === 'UID') cur.uid = value.trim();
        else if (key === 'SUMMARY') cur.summary = unescapeIcsText(value);
        else if (key === 'DESCRIPTION') cur.description = unescapeIcsText(value);
        else if (key === 'DTSTART') cur.dtstart = value.trim();
        else if (key === 'DTEND') cur.dtend = value.trim();
        else if (key === 'RRULE') cur.rrule = value.trim();
        else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
        else if (key === 'X-COLOR') cur.color = value.trim();
    }

    return events;
}

// формуємо блок ```mycalendar-event ... ``` так, як у тебе вже прийнято
function buildMyCalBlock(ev: IcsEvent): string {
    const lines: string[] = [];
    lines.push('```mycalendar-event');

    if (ev.uid) lines.push(`uid: ${ev.uid}`);
    if (ev.summary) lines.push(`summary: ${ev.summary}`);
    if (ev.description) lines.push(`description: ${ev.description}`);
    if (ev.location) lines.push(`location: ${ev.location}`);
    if (ev.dtstart) lines.push(`dtstart: ${ev.dtstart}`);
    if (ev.dtend) lines.push(`dtend: ${ev.dtend}`);
    if (ev.rrule) lines.push(`rrule: ${ev.rrule}`);
    if (ev.color) lines.push(`color: ${ev.color}`);

    lines.push('```');
    return lines.join('\n');
}

function escapeReg(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceEventBlockByUid(body: string, uid: string, newBlock: string): string {
    // замінимо перший блок, який містить uid
    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let changed = false;

    const out = body.replace(re, (full, p1, inner) => {
        if (new RegExp(`^\\s*uid:\\s*${escapeReg(uid)}\\s*$`, 'im').test(inner)) {
            changed = true;
            return `${p1}${newBlock}`;
        }
        return full;
    });

    if (changed) return out;

    // якщо не знайшли - допишемо в кінець
    return (body ? body.replace(/\s+$/, '') + '\n\n' : '') + newBlock + '\n';
}

export async function importIcsIntoNotes(
    joplin: any,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string
): Promise<{ added: number; updated: number; skipped: number; errors: number }> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch {
        }
    };

    const events = parseIcs(ics);
    await say(`Parsed ${events.length} VEVENT(s)`);

    // existing map uid -> {id, body}
    const existing: Record<string, { id: string; body: string }> = {};
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['notes'], {fields: ['id', 'title', 'body'], limit: 100, page});

        for (const n of res.items || []) {
            if (!n.body || typeof n.body !== 'string') continue;
            if (!n.body.includes('```mycalendar-event')) continue;

            const m = n.body.match(/^\s*```mycalendar-event[\s\S]*?^\s*uid:\s*(.+?)\s*$/im);
            if (m && m[1]) {
                const uid = m[1].trim();
                existing[uid] = {id: n.id, body: n.body};
            }
        }

        if (!res.has_more) break;
        page++;
    }

    let added = 0, updated = 0, skipped = 0, errors = 0;

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) {
            skipped++;
            continue;
        }

        const block = buildMyCalBlock(ev);

        if (existing[uid]) {
            try {
                const {id, body} = existing[uid];
                const newBody = replaceEventBlockByUid(body, uid, block);
                const patch: any = {
                    body: newBody
                }
                if (targetFolderId) {
                    patch.parent_id = targetFolderId;
                }
                if (newBody !== body) {
                    await joplin.data.put(['notes', id], null, patch);
                    updated++;
                    await say(`Updated: ${uid}`);
                } else {
                    skipped++;
                }
            } catch (e) {
                errors++;
                await say(`ERROR update: ${uid} - ${String((e as any)?.message || e)}`);
            }
        } else {
            try {
                const noteBody: any = {
                    title: ev.summary || 'Event',
                    body: block,
                }
                if (targetFolderId) {
                    noteBody.parent_id = targetFolderId;
                }
                await joplin.data.post(['notes'], null, noteBody);
                added++;
                await say(`Added: ${uid}`);
            } catch (e) {
                errors++;
                await say(`ERROR add: ${uid} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    return {added, updated, skipped, errors};
}
