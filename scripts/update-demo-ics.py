#!/usr/bin/env python3
import re
import sys
import os
from datetime import datetime, timedelta

def update_ics_dates(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.")
        return

    with open(file_path, 'r') as f:
        content = f.read()

    # Get today's date (midnight)
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Find the earliest DTSTART to calculate the offset
    start_matches = re.findall(r'DTSTART(?:;VALUE=DATE)?:(\d{8})', content)
    if not start_matches:
        print("No dates found in the file.")
        return

    earliest_str = min(start_matches)
    earliest_date = datetime.strptime(earliest_str, "%Y%m%d")

    # Offset to make the earliest event start today
    offset = today - earliest_date

    if offset.days == 0:
        print("Dates are already up to date. No shift needed.")
        return

    print(f"Shifting dates by {offset.days} days...")

    def shift_match(m):
        prefix = m.group(1)
        params = m.group(2) or ""
        date_val = m.group(3)
        
        try:
            if 'T' in date_val:
                if date_val.endswith('Z'):
                    dt = datetime.strptime(date_val, '%Y%m%dT%H%M%SZ')
                    new_dt = dt + offset
                    return f"{prefix}{params}:{new_dt.strftime('%Y%m%dT%H%M%SZ')}"
                else:
                    dt = datetime.strptime(date_val, '%Y%m%dT%H%M%S')
                    new_dt = dt + offset
                    return f"{prefix}{params}:{new_dt.strftime('%Y%m%dT%H%M%S')}"
            else:
                dt = datetime.strptime(date_val, '%Y%m%d')
                new_dt = dt + offset
                return f"{prefix}{params}:{new_dt.strftime('%Y%m%d')}"
        except Exception as e:
            print(f"Error parsing date {date_val}: {e}")
            return m.group(0)

    # Pattern handles DTSTART, DTEND, DTSTAMP
    new_content = re.sub(r'(DTSTART|DTEND|DTSTAMP)([^:\n]*):(\d{8}T?\d{0,6}Z?)', shift_match, content)

    with open(file_path, 'w') as f:
        f.write(new_content)
    
    print(f"Successfully updated {file_path}")

if __name__ == "__main__":
    target_file = "/media/volodymyr/SECOND_1TB/USER_FILES/PROJECTS/JOPLIN/joplin-plugin-my-calendar/examples/demo_import.ics"
    if len(sys.argv) > 1:
        target_file = sys.argv[1]
    
    update_ics_dates(target_file)
