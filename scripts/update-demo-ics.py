#!/usr/bin/env python3
import argparse
from datetime import date, datetime, timedelta
from pathlib import Path
import re
from typing import Optional

DATE_VALUE_RE = re.compile(r'^\d{8}(?:T\d{6}Z?)?$')
SHIFTABLE_ICS_PROPERTY_RE = re.compile(
    r'^(DTSTART|DTEND|DTSTAMP|RECURRENCE-ID|EXDATE|RDATE|TRIGGER|DUE|COMPLETED|CREATED|LAST-MODIFIED)'
    r'([^:\n]*):([^\n]+)',
    re.MULTILINE,
)
ICS_UNTIL_RE = re.compile(r'UNTIL=(\d{8}(?:T\d{6}Z?)?)')
EARLIEST_ICS_START_RE = re.compile(
    r'^DTSTART(?:[^:\n]*):(\d{8})(?:T\d{6}Z?)?$',
    re.MULTILINE,
)

MYCAL_DATE_RE = re.compile(
    r'(\d{4}-\d{2}-\d{2})'
    r'((?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:?\d{2})?)',
)
SHIFTABLE_MYCAL_FIELD_RE = re.compile(
    r'^(\s*(?:start|end|repeat_until|exdate)\s*:\s*)([^\n]+)',
    re.IGNORECASE | re.MULTILINE,
)
MYCAL_RECURRENCE_ID_RE = re.compile(
    r'^(\s*recurrence_id\s*:\s*(?:(?:DATE|[^:\n]+/[^:\n]+):)?)'
    r'(\d{8}(?:T\d{6}Z?)?)',
    re.IGNORECASE | re.MULTILINE,
)
MYCAL_ABSOLUTE_VALARM_RE = re.compile(
    r'^(\s*valarm\s*:\s*\{[^\n]*"trigger"\s*:\s*")'
    r'(\d{8}T\d{6}Z?)',
    re.IGNORECASE | re.MULTILINE,
)
EARLIEST_MYCAL_START_RE = re.compile(
    r'^\s*start\s*:\s*(\d{4}-\d{2}-\d{2})',
    re.IGNORECASE | re.MULTILINE,
)


def shift_compact_date_value(date_value: str, offset: timedelta) -> str:
    if 'T' in date_value:
        if date_value.endswith('Z'):
            parsed = datetime.strptime(date_value, '%Y%m%dT%H%M%SZ')
            return (parsed + offset).strftime('%Y%m%dT%H%M%SZ')

        parsed = datetime.strptime(date_value, '%Y%m%dT%H%M%S')
        return (parsed + offset).strftime('%Y%m%dT%H%M%S')

    parsed = datetime.strptime(date_value, '%Y%m%d')
    return (parsed + offset).strftime('%Y%m%d')


def shift_mycalendar_value(value: str, offset: timedelta) -> str:
    def replace_date(match: re.Match) -> str:
        parsed = datetime.strptime(match.group(1), '%Y-%m-%d')
        return (parsed + offset).strftime('%Y-%m-%d') + match.group(2)

    return MYCAL_DATE_RE.sub(replace_date, value)


def weekday_preserving_offset(earliest: date, today: date) -> timedelta:
    """Move an old demo into the current seven-day window without changing weekdays."""
    if earliest >= today:
        return timedelta(0)

    days_behind = (today - earliest).days
    weeks = (days_behind + 6) // 7
    return timedelta(days=weeks * 7)


def date_at_month_offset(value: date, months: int, day: int) -> Optional[date]:
    month_index = value.year * 12 + value.month - 1 + months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    try:
        return date(year, month, day)
    except ValueError:
        return None


def markdown_offset(content: str, earliest: date, today: date) -> timedelta:
    repeat_match = re.search(r'^\s*repeat\s*:\s*(\w+)', content, re.IGNORECASE | re.MULTILINE)
    repeat = repeat_match.group(1).lower() if repeat_match else 'none'

    if earliest >= today:
        return timedelta(0)

    if repeat == 'weekly':
        return weekday_preserving_offset(earliest, today)

    if repeat == 'monthly':
        month_day_match = re.search(
            r'^\s*bymonthday\s*:\s*(\d{1,2})',
            content,
            re.IGNORECASE | re.MULTILINE,
        )
        anchor_day = int(month_day_match.group(1)) if month_day_match else earliest.day
        months = (today.year - earliest.year) * 12 + today.month - earliest.month
        while True:
            candidate = date_at_month_offset(earliest, months, anchor_day)
            if candidate is not None and candidate >= today:
                return candidate - earliest
            months += 1

    if repeat == 'yearly':
        year = today.year
        while True:
            try:
                candidate = date(year, earliest.month, earliest.day)
            except ValueError:
                year += 1
                continue
            if candidate >= today:
                return candidate - earliest
            year += 1

    return today - earliest


def update_ics_content(content: str, offset: timedelta) -> str:
    def shift_property(match: re.Match) -> str:
        property_name = match.group(1)
        params = match.group(2) or ''
        raw_value = match.group(3)

        # EXDATE and RDATE may contain comma-separated values. RDATE can also
        # contain a start/end or start/duration period.
        if property_name in {'EXDATE', 'RDATE'}:
            shifted_values = []
            for item in raw_value.split(','):
                stripped = item.strip()
                period_parts = stripped.split('/')
                shifted_parts = [
                    shift_compact_date_value(part, offset)
                    if DATE_VALUE_RE.fullmatch(part)
                    else part
                    for part in period_parts
                ]
                shifted_values.append('/'.join(shifted_parts))
            return f"{property_name}{params}:{','.join(shifted_values)}"

        if not DATE_VALUE_RE.fullmatch(raw_value.strip()):
            return match.group(0)
        return f"{property_name}{params}:{shift_compact_date_value(raw_value.strip(), offset)}"

    shifted = SHIFTABLE_ICS_PROPERTY_RE.sub(shift_property, content)
    return ICS_UNTIL_RE.sub(
        lambda match: f"UNTIL={shift_compact_date_value(match.group(1), offset)}",
        shifted,
    )


def update_markdown_content(content: str, offset: timedelta) -> str:
    shifted = SHIFTABLE_MYCAL_FIELD_RE.sub(
        lambda match: match.group(1) + shift_mycalendar_value(match.group(2), offset),
        content,
    )
    shifted = MYCAL_RECURRENCE_ID_RE.sub(
        lambda match: match.group(1) + shift_compact_date_value(match.group(2), offset),
        shifted,
    )
    return MYCAL_ABSOLUTE_VALARM_RE.sub(
        lambda match: match.group(1) + shift_compact_date_value(match.group(2), offset),
        shifted,
    )


def earliest_start(content: str, suffix: str) -> Optional[date]:
    if suffix == '.ics':
        matches = EARLIEST_ICS_START_RE.findall(content)
        return datetime.strptime(min(matches), '%Y%m%d').date() if matches else None

    if suffix == '.md':
        matches = EARLIEST_MYCAL_START_RE.findall(content)
        return datetime.strptime(min(matches), '%Y-%m-%d').date() if matches else None

    return None


def update_file(file_path: Path, today: date) -> bool:
    if not file_path.exists():
        print(f"Error: File {file_path} not found.")
        return False

    suffix = file_path.suffix.lower()
    if suffix not in {'.ics', '.md'}:
        print(f"Skipping unsupported file type: {file_path}")
        return False

    content = file_path.read_text(encoding='utf-8')
    earliest = earliest_start(content, suffix)
    if earliest is None:
        print(f"No event start dates found in {file_path}.")
        return False

    offset = (
        weekday_preserving_offset(earliest, today)
        if suffix == '.ics'
        else markdown_offset(content, earliest, today)
    )
    if offset == timedelta(0):
        print(f"Dates in {file_path} are already current or in the future.")
        return False

    if suffix == '.ics':
        new_content = update_ics_content(content, offset)
    else:
        new_content = update_markdown_content(content, offset)

    file_path.write_text(new_content, encoding='utf-8')
    print(f"Updated {file_path} by {offset.days} days.")
    return True


def parse_args() -> argparse.Namespace:
    examples_dir = Path(__file__).resolve().parent.parent / 'examples'
    parser = argparse.ArgumentParser(
        description=(
            'Refresh demo ICS or My Calendar Markdown dates while preserving '
            'weekly, monthly, and yearly recurrence anchors.'
        ),
    )
    parser.add_argument(
        'files',
        nargs='*',
        help='ICS or Markdown files to update. Defaults to examples/demo_import.ics.',
    )
    parser.add_argument(
        '--all-examples',
        action='store_true',
        help='Update every .ics and .md file in the examples directory.',
    )
    parser.set_defaults(examples_dir=examples_dir)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.all_examples:
        paths = sorted(
            path
            for path in args.examples_dir.iterdir()
            if path.suffix.lower() in {'.ics', '.md'}
        )
    elif args.files:
        paths = [Path(value).expanduser().resolve() for value in args.files]
    else:
        paths = [args.examples_dir / 'demo_import.ics']

    today = date.today()
    for path in paths:
        update_file(path, today)


if __name__ == '__main__':
    main()
