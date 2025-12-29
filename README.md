# Attention!!! Under development, under usability testing.

# joplin-plugin-my-calendar

The [Joplin](https://joplinapp.org/) plugin provides the ability to:

- Use notes as events;
- Display notes as events in the monthly calendar section;
- Import the contents of an *.ics file into notes as events in a previously specified notebook (
  Desktop [Joplin](https://joplinapp.org/) only).

---

## Sections

### Monthly calendar section

- Navigation: previous month, current month, next month buttons, selected month name and year;
- A grid with all days of the month;
- Event bar(s) inside the day grid;

### Day events section

- Selected day events list with event details like: color, title and time;
- Event list item is clickable;

### ICS import section (Desktop Joplin only)

Import behavior: each event from ics file is unique by uid, first import note as event will be created, socond import
each not will be updated or ignored, depends from

- Form for ICS file import:
    - Target notebook select box and reload list button;
    - ICS File picker and import button;

---

## Syntax and properties supported by the calendar

~~~
```mycalendar-event
title: The name of the event
start: 2025-08-12 10:00:00-04:00
end: 2025-08-12 12:00:00-04:00
tz: America/Toronto
color: #ff8800
location: random string with location
description: Description of the event

repeat: daily|weekly|monthly|yearly
repeat_interval: 1
repeat_until: 2025-12-31 23:59:59-04:00
byweekday: MO,TU,WE,TH,FR     # weekly
bymonthday: 12                # monthly
uid: <unique ical id>         # string for event, more important for mass import from ical. Not required for manually created note (as a calendar event).
```
~~~

### start,end and tz variations:

1) This time will be converted to ...

```
TODO
```

2) This time will be converted to ...

```
TODO
```

3) This time will be converted to ...

```
TODO
```

4) This time will be converted to ...

```
TODO
```

---

## Development

### Build command

`npm run pack;`

### Security

- `npm audit;npm audit fix;`
- need to find more tools for security scanning;

### Testing

- Tested just manually with [Joplin](https://joplinapp.org/) Desktop (Ubuntu 24 release);
- Tested just manually with [Joplin](https://joplinapp.org/) Android;
- Automated testing will be soon, hope;

---



