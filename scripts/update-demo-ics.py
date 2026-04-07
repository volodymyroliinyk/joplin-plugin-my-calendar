#!/usr/bin/env python3
import argparse
from pathlib import Path
import re
import os
from datetime import date, datetime, timedelta

DATE_VALUE_RE = re.compile(r'^\d{8}(?:T\d{6}Z?)?$')
SHIFTABLE_PROPERTY_RE = re.compile(
    r'(DTSTART|DTEND|DTSTAMP|RECURRENCE-ID|EXDATE|RDATE|DUE|COMPLETED|CREATED|LAST-MODIFIED)([^:\n]*):([^\n]+)'
)
UNTIL_RE = re.compile(r'UNTIL=(\d{8}(?:T\d{6}Z?)?)')
EARLIEST_DTSTART_RE = re.compile(r'^DTSTART(?:[^:\n]*):(\d{8})(?:T\d{6}Z?)?$', re.MULTILINE)


def shift_date_value(date_val, offset):
    if 'T' in date_val:
        if date_val.endswith('Z'):
            dt = datetime.strptime(date_val, '%Y%m%dT%H%M%SZ')
            new_dt = dt + offset
            return new_dt.strftime('%Y%m%dT%H%M%SZ')

        dt = datetime.strptime(date_val, '%Y%m%dT%H%M%S')
        new_dt = dt + offset
        return new_dt.strftime('%Y%m%dT%H%M%S')

    dt = datetime.strptime(date_val, '%Y%m%d')
    new_dt = dt + offset
    return new_dt.strftime('%Y%m%d')


def parse_args():
    default_file = Path(__file__).resolve().parent.parent / 'examples' / 'demo_import.ics'
    parser = argparse.ArgumentParser(
        description='Shift ICS dates so the earliest DTSTART lands on today.',
    )
    parser.add_argument(
        'file',
        nargs='?',
        default=str(default_file),
        help='Path to the ICS file to update. Defaults to examples/demo_import.ics.',
    )
    return parser.parse_args()


def update_ics_dates(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.")
        return

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    today = date.today()

    # Find the earliest DTSTART to calculate the offset
    start_matches = EARLIEST_DTSTART_RE.findall(content)
    if not start_matches:
        print("No dates found in the file.")
        return

    earliest_str = min(start_matches)
    earliest_date = datetime.strptime(earliest_str, "%Y%m%d").date()

    # Offset to make the earliest event start today
    offset = today - earliest_date

    if offset == timedelta(0):
        print("Dates are already up to date. No shift needed.")
        return

    print(f"Shifting dates by {offset.days} days...")

    def shift_match(m):
        prefix = m.group(1)
        params = m.group(2) or ""
        date_val = m.group(3)

        try:
            if prefix == 'EXDATE':
                shifted_values = []
                for item in date_val.split(','):
                    stripped = item.strip()
                    if DATE_VALUE_RE.match(stripped):
                        shifted_values.append(shift_date_value(stripped, offset))
                    else:
                        shifted_values.append(stripped)
                return f"{prefix}{params}:{','.join(shifted_values)}"

            return f"{prefix}{params}:{shift_date_value(date_val, offset)}"
        except Exception as e:
            print(f"Error parsing date {date_val}: {e}")
            return m.group(0)

    def shift_rrule_until(m):
        date_val = m.group(1)
        try:
            return f"UNTIL={shift_date_value(date_val, offset)}"
        except Exception as e:
            print(f"Error parsing RRULE UNTIL {date_val}: {e}")
            return m.group(0)

    # Pattern handles event timestamps and recurrence anchors.
    new_content = SHIFTABLE_PROPERTY_RE.sub(shift_match, content)
    new_content = UNTIL_RE.sub(shift_rrule_until, new_content)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"Successfully updated {file_path}")


if __name__ == "__main__":
    args = parse_args()
    update_ics_dates(str(Path(args.file).expanduser()))
