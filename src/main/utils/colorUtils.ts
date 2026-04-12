const HEX_COLOR_SHORT_OR_LONG_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX_COLOR_LONG_RE = /^#[0-9a-fA-F]{6}$/;

type NormalizeHexColorOptions = {
    allowShort?: boolean;
};

export function normalizeHexColor(input: unknown, options: NormalizeHexColorOptions = {}): string {
    const allowShort = options.allowShort !== false;
    const raw = String(input ?? '').trim();
    if (!raw) return '';

    const matcher = allowShort ? HEX_COLOR_SHORT_OR_LONG_RE : HEX_COLOR_LONG_RE;
    if (!matcher.test(raw)) return '';
    return raw.toLowerCase();
}

export function normalizeColorIfHex(input: unknown, options: NormalizeHexColorOptions = {}): string {
    const raw = String(input ?? '').trim();
    if (!raw) return '';
    return normalizeHexColor(raw, options) || raw;
}
