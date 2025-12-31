// src/main/services/icsImportService.ts

type IcsEvent = {
    uid?: string;
    recurrence_id?: string;

    // MyCalendar normalized fields (what we write into ```mycalendar-event``` blocks)
    title?: string;
    description?: string;
    location?: string;
    color?: string;

    start?: string; // "2025-08-12 10:00:00-04:00" or without offset (with tz)
    end?: string;
    tz?: string; // IANA tz, e.g. "America/Toronto"

    repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    repeat_interval?: number;
    repeat_until?: string;
    byweekday?: string;   // "MO,TU,WE"
    bymonthday?: string;  // "12"

    all_day?: boolean;
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

// Take the value after ":" (ignore parameters like DTSTART;TZID=...)
function parseLineValue(line: string): { key: string; value: string; params: Record<string, string> } | null {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const left = line.slice(0, i);
    const value = line.slice(i + 1);

    const parts = left.split(';').map(p => p.trim()).filter(Boolean);
    const key = (parts[0] || '').toUpperCase();

    const params: Record<string, string> = {};
    for (let j = 1; j < parts.length; j++) {
        const p = parts[j];
        const eq = p.indexOf('=');
        if (eq > 0) {
            const k = p.slice(0, eq).toUpperCase();
            const v = p.slice(eq + 1);
            params[k] = v;
        }
    }

    return {key, value, params};
}

function icsDateToMyCalText(icsValue: string): string | undefined {
    const v = icsValue.trim();

    // YYYYMMDDTHHMMSSZ
    let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}+00:00`;

    // YYYYMMDDTHHMMSS
    m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;

    // YYYYMMDD (all-day)
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;

    // Already ISO-like -> normalize "T" to space
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.replace('T', ' ');

    return undefined;
}

function normalizeRepeatFreq(freq?: string): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined {
    if (!freq) return undefined;
    const f = freq.toLowerCase();
    if (f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'yearly') return f as any;
    return undefined;
}

function parseRRule(rrule?: string): Partial<IcsEvent> {
    if (!rrule) return {};
    const parts = rrule.split(';').map(s => s.trim()).filter(Boolean);
    const map: Record<string, string> = {};
    for (const p of parts) {
        const i = p.indexOf('=');
        if (i > 0) map[p.slice(0, i).toUpperCase()] = p.slice(i + 1);
    }

    const out: Partial<IcsEvent> = {};
    const freq = normalizeRepeatFreq(map['FREQ']);
    if (freq) out.repeat = freq;

    const interval = map['INTERVAL'] ? parseInt(map['INTERVAL'], 10) : NaN;
    if (Number.isFinite(interval) && interval >= 1) out.repeat_interval = interval;

    // UNTIL is UTC in many feeds; keep as "+00:00" when Z
    const until = map['UNTIL'] ? icsDateToMyCalText(map['UNTIL']) : undefined;
    if (until) out.repeat_until = until;

    if (map['BYDAY']) out.byweekday = map['BYDAY'].trim();
    if (map['BYMONTHDAY']) out.bymonthday = map['BYMONTHDAY'].trim();

    return out;
}

function stripInlineComment(line: string): string {
    // Remove " # comment" (but keep if # is in the middle of a value without leading whitespace)
    const i = line.indexOf('#');
    if (i < 0) return line;
    // treat as comment only if there is whitespace before '#'
    const before = line.slice(0, i);
    if (/\s$/.test(before)) return before.trimEnd();
    return line;
}

// Parses the "key: value" format (events separated by blank lines or "---")
function parseMyCalKeyValueText(text: string): IcsEvent[] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const events: IcsEvent[] = [];
    let cur: IcsEvent = {};

    const flush = () => {
        const hasAny =
            !!cur.uid || !!cur.title || !!cur.start || !!cur.end || !!cur.description || !!cur.location || !!cur.color ||
            !!cur.repeat || !!cur.byweekday || !!cur.bymonthday || !!cur.repeat_until;
        if (hasAny) {
            events.push(cur);
            cur = {};
        }
    };

    for (const raw of lines) {
        const line0 = stripInlineComment(raw).trim();
        if (!line0) {
            flush();
            continue;
        }
        if (line0 === '---') {
            flush();
            continue;
        }

        const m = line0.match(/^\s*([a-zA-Z_]+)\s*:\s*(.+)\s*$/);
        if (!m) continue;

        const k = m[1].toLowerCase();
        const v = m[2].trim();

        if (k === 'uid') cur.uid = v;
        else if (k === 'recurrence_id') cur.recurrence_id = v;
        else if (k === 'title' || k === 'summary') cur.title = v;
        else if (k === 'description') cur.description = v;
        else if (k === 'location') cur.location = v;
        else if (k === 'color') cur.color = v;

        else if (k === 'start') cur.start = v;
        else if (k === 'end') cur.end = v;
        else if (k === 'tz' || k === 'timezone') cur.tz = v;

        else if (k === 'repeat') cur.repeat = normalizeRepeatFreq(v) || 'none';
        else if (k === 'repeat_interval') {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= 1) cur.repeat_interval = n;
        } else if (k === 'repeat_until') cur.repeat_until = v;
        else if (k === 'byweekday') cur.byweekday = v;
        else if (k === 'bymonthday') cur.bymonthday = v;
    }

    flush();
    return events;
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
        const {key, value, params} = parsed;
        const isDateOnly = (value: string, params: Record<string, string>) =>
            (params['VALUE'] || '').toUpperCase() === 'DATE' || /^\d{8}$/.test(value.trim());

        if (key === 'UID') cur.uid = value.trim();
        else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
        else if (key === 'DESCRIPTION') cur.description = unescapeIcsText(value);
        else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
        else if (key === 'X-COLOR') cur.color = value.trim();

        else if (key === 'DTSTART') {
            cur.start = icsDateToMyCalText(value) || value.trim();
            if (isDateOnly(value, params)) cur.all_day = true;
            if (params['TZID'] && !cur.tz) cur.tz = params['TZID'];
        } else if (key === 'DTEND') {
            cur.end = icsDateToMyCalText(value) || value.trim();
            if (isDateOnly(value, params)) cur.all_day = true;
            if (params['TZID'] && !cur.tz) cur.tz = params['TZID'];
        } else if (key === 'RRULE') {
            Object.assign(cur, parseRRule(value.trim()));
        } else if (key === 'RECURRENCE-ID') {
            const ridVal = value.trim();
            const tzid = params['TZID'];
            const valType = (params['VALUE'] || '').toUpperCase(); // DATE / DATE-TIME

            if (valType === 'DATE') {
                // e.g. RECURRENCE-ID;VALUE=DATE:20200727
                cur.recurrence_id = `DATE:${ridVal}`;
            } else if (tzid) {
                // e.g. RECURRENCE-ID;TZID=America/Toronto:20250101T090000
                cur.recurrence_id = `${tzid}:${ridVal}`;
                if (!cur.tz) cur.tz = tzid;
            } else {
                // e.g. RECURRENCE-ID:20250101T140000Z
                cur.recurrence_id = ridVal;
            }
        }
    }

    return events;
}

function parseImportText(text: string): IcsEvent[] {
    const t = text.trim();
    if (/BEGIN:VCALENDAR/i.test(t) || /BEGIN:VEVENT/i.test(t)) return parseIcs(text);
    return parseMyCalKeyValueText(text);
}


// Form the block ```mycalendar-event ... ``` as you have already done
function buildMyCalBlock(ev: IcsEvent): string {
    const lines: string[] = [];
    lines.push('```mycalendar-event');

    if (ev.title) lines.push(`title: ${ev.title}`);
    if (ev.start) lines.push(`start: ${ev.start}`);
    if (ev.end) lines.push(`end: ${ev.end}`);
    if (ev.tz) lines.push(`tz: ${ev.tz}`);
    if (ev.color) lines.push(`color: ${ev.color}`);
    if (ev.location) lines.push(`location: ${ev.location}`);
    if (ev.description) lines.push(`description: ${ev.description}`);

    const repeat = ev.repeat && ev.repeat !== 'none' ? ev.repeat : undefined;
    if (repeat) {
        lines.push('');
        lines.push(`repeat: ${repeat}`);
        lines.push(`repeat_interval: ${ev.repeat_interval ?? 1}`);
        if (ev.repeat_until) lines.push(`repeat_until: ${ev.repeat_until}`);
        if (ev.byweekday) lines.push(`byweekday: ${ev.byweekday}`);
        if (ev.bymonthday) lines.push(`bymonthday: ${ev.bymonthday}`);
    }

    if (ev.all_day) lines.push(`all_day: true`);

    if (ev.uid) {
        lines.push('');
        lines.push(`uid: ${ev.uid}`);
        if (ev.recurrence_id) {
            lines.push(`recurrence_id: ${ev.recurrence_id}`);
        }
    }

    lines.push('```');
    return lines.join('\n');
}

function escapeReg(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeEventKey(uid: string, recurrenceId?: string): string {
    return `${(uid || '').trim()}|${(recurrenceId || '').trim()}`;
}

function parseUidAndRecurrence(inner: string): { uid?: string; recurrence_id?: string } {
    const uidM = inner.match(/^\s*uid\s*:\s*(.+?)\s*$/im);
    const ridM = inner.match(/^\s*recurrence_id\s*:\s*(.+?)\s*$/im);
    return {
        uid: uidM?.[1]?.trim(),
        recurrence_id: ridM?.[1]?.trim(),
    };
}

function extractAllEventKeysFromBody(body: string): string[] {
    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    const keys: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);
        if (!meta.uid) continue;
        keys.push(makeEventKey(meta.uid, meta.recurrence_id));
    }
    return keys;
}


function replaceEventBlockByKey(body: string, uid: string, recurrenceId: string | undefined, newBlock: string): string {
    const targetUid = (uid || '').trim();
    const targetRid = (recurrenceId || '').trim();

    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let changed = false;

    const out = body.replace(re, (full, p1, inner) => {
        const meta = parseUidAndRecurrence(inner);

        const u = (meta.uid || '').trim();
        const r = (meta.recurrence_id || '').trim();

        if (u !== targetUid) return full;

        // For master events (no RECURRENCE-ID): match blocks that also have no recurrence_id
        if (!targetRid) {
            if (!r) {
                changed = true;
                return `${p1}${newBlock}`;
            }
            return full;
        }

        // For occurrences/exceptions: must match recurrence_id exactly
        if (r === targetRid) {
            changed = true;
            return `${p1}${newBlock}`;
        }

        return full;
    });

    if (changed) return out;

    // Not found: append
    return (body ? body.replace(/\s+$/, '') + '\n\n' : '') + newBlock + '\n';
}

function parseColor(inner: string): string | undefined {
    const m = inner.match(/^\s*color\s*:\s*(.+?)\s*$/im);
    return m?.[1]?.trim();
}

function extractEventColorFromBody(body: string, uid: string, recurrenceId?: string): string | undefined {
    const targetUid = (uid || '').trim();
    const targetRid = (recurrenceId || '').trim();

    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);

        const u = (meta.uid || '').trim();
        const r = (meta.recurrence_id || '').trim();

        if (u !== targetUid) continue;

        // master event
        if (!targetRid) {
            if (!r) return parseColor(inner);
            continue;
        }

        // recurrence instance
        if (r === targetRid) return parseColor(inner);
    }

    return undefined;
}



export async function importIcsIntoNotes(
    joplin: any,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    importDefaultColor?: string,
): Promise<{ added: number; updated: number; skipped: number; errors: number }> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch {
        }
    };

    const events = parseImportText(ics);
    await say(`Parsed ${events.length} VEVENT(s)`);

    // existing map uid -> {id, body}
    const existing: Record<string, { id: string; title: string; body: string }> = {};
    let page = 1;

    while (true) {
        const res = await joplin.data.get(['notes'], {fields: ['id', 'title', 'body'], limit: 100, page});

        for (const n of res.items || []) {
            if (!n.body || typeof n.body !== 'string') continue;
            if (!n.body.includes('```mycalendar-event')) continue;

            const keys = extractAllEventKeysFromBody(n.body);
            for (const k of keys) {
                existing[k] = {id: n.id, title: n.title || '', body: n.body};
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

        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        if (preserveLocalColor && existing[key] && !ev.color) {
            const existingColor = extractEventColorFromBody(existing[key].body, uid, rid);
            if (existingColor) ev.color = existingColor;
        }

        // 2) apply default import color if still missing
        if (!ev.color && importDefaultColor) {
            ev.color = importDefaultColor;
        }

        const block = buildMyCalBlock(ev);
        const desiredTitle = ev.title || 'Event';

        if (existing[key]) {
            try {
                const {id, body, title} = existing[key];

                const newBody = replaceEventBlockByKey(body, uid, rid, block);

                const patch: any = {};
                if (newBody !== body) patch.body = newBody;
                if (desiredTitle !== title) patch.title = desiredTitle;

                if (Object.keys(patch).length > 0) {
                    await joplin.data.put(['notes', id], null, patch);
                    updated++;
                } else {
                    skipped++;
                }
            } catch (e) {
                errors++;
                await say(`ERROR update: ${key} - ${String((e as any)?.message || e)}`);
            }
        } else {
            try {
                const noteBody: any = {title: desiredTitle, body: block};
                if (targetFolderId) noteBody.parent_id = targetFolderId;

                await joplin.data.post(['notes'], null, noteBody);
                added++;
            } catch (e) {
                errors++;
                await say(`ERROR create: ${key} - ${String((e as any)?.message || e)}`);
            }
        }

    }

    return {added, updated, skipped, errors};
}
