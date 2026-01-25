// src/main/utils/joplinUtils.ts

export function normalizeRecurrenceIdForKey(recurrenceId?: string): string {
    const v = (recurrenceId || '').trim();
    if (!v) return '';

    // Keep DATE:yyyyMMdd as-is (date-only recurrence instances)
    if (/^DATE:\d{8}$/i.test(v)) return v;

    // Backward compatible normalization
    const tzMatch = v.match(/^[^:]+:(\d{8}T\d{6}Z?)$/);
    if (tzMatch) return tzMatch[1];

    return v;
}

export function makeEventKey(uid: string, recurrenceId?: string): string {
    const u = (uid || '').trim();
    const rid = normalizeRecurrenceIdForKey(recurrenceId);
    return `${u}|${rid}`;
}

export function parseUidAndRecurrence(inner: string): { uid?: string; recurrence_id?: string } {
    const uidM = inner.match(/^[ \t]*uid[ \t]*:[ \t]*(.*?)[ \t]*$/im);
    const ridM = inner.match(/^[ \t]*recurrence_id[ \t]*:[ \t]*(.*?)[ \t]*$/im);
    return {
        uid: uidM?.[1]?.trim() || undefined,
        recurrence_id: (ridM?.[1] ?? '').trim(),
    };
}

export function extractAllAlarmKeysFromBody(body: string): { key: string; uid: string; recurrence_id: string }[] {
    const re = /(^|\r?\n)[ \t]*```mycalendar-alarm[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    const out: { key: string; uid: string; recurrence_id: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);
        if (!meta.uid) continue;
        const rid = (meta.recurrence_id ?? '').trim();
        out.push({key: makeEventKey(meta.uid, rid), uid: meta.uid, recurrence_id: rid});
    }
    return out;
}

export function extractAllEventKeysFromBody(body: string): string[] {
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

export function replaceEventBlockByKey(
    body: string,
    uid: string,
    recurrenceId: string | undefined,
    newBlock: string,
): string {
    const targetUid = (uid || '').trim();
    const targetRid = normalizeRecurrenceIdForKey(recurrenceId);

    const re =
        /(^|\r?\n)([ \t]*```mycalendar-event[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```)(?=\r?\n|$)/g;

    let changed = false;

    const out = body.replace(re, (fullMatch, prefixNL, wholeBlock) => {
        const innerM = wholeBlock.match(/^[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/);
        const inner = innerM?.[1] ?? '';

        const meta = parseUidAndRecurrence(inner);
        const u = (meta.uid || '').trim();
        const r = normalizeRecurrenceIdForKey(meta.recurrence_id);

        if (u !== targetUid) return fullMatch;

        if (!targetRid) {
            if (!r) {
                changed = true;
                return `${prefixNL}${newBlock}`;
            }
            return fullMatch;
        }

        if (r === targetRid) {
            changed = true;
            return `${prefixNL}${newBlock}`;
        }

        return fullMatch;
    });

    if (changed) return out;

    const trimmed = (body || '').replace(/\s+$/, '');
    return (trimmed ? trimmed + '\n\n' : '') + newBlock + '\n';
}

function parseColor(inner: string): string | undefined {
    const m = inner.match(/^\s*color\s*:\s*(.+?)\s*$/im);
    return m?.[1]?.trim();
}

export function extractEventColorFromBody(body: string, uid: string, recurrenceId?: string): string | undefined {
    const targetUid = (uid || '').trim();
    const targetRid = normalizeRecurrenceIdForKey(recurrenceId);

    const re = /(^|\r?\n)[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(body)) !== null) {
        const inner = m[2] || '';
        const meta = parseUidAndRecurrence(inner);

        const u = (meta.uid || '').trim();
        const r = normalizeRecurrenceIdForKey(meta.recurrence_id);

        if (u !== targetUid) continue;

        if (!targetRid) {
            if (!r) return parseColor(inner);
            continue;
        }

        if (r === targetRid) return parseColor(inner);
    }

    return undefined;
}
