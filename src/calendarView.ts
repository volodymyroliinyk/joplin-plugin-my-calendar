import joplin from 'api';

// src/calendarView.ts
export async function createCalendarPanel(joplin: any): Promise<string> {
    const panelId = await joplin.views.panels.create('mycalendarPanel');

    await joplin.views.panels.setHtml(panelId, `
    <div id="cal-root" style="padding:8px;font-family:system-ui">
      <div style="font-weight:700;margin-bottom:4px">MyCalendar panel booting…</div>
      <div id="calendar"></div>
      <div id="events"></div>
    </div>
  `);

    await joplin.views.panels.addScript(panelId, './ui/calendar.css');
    await joplin.views.panels.addScript(panelId, './ui/calendar.js');
    await joplin.views.panels.show(panelId);
    console.log('[MyCalendar] calendarView created');

    return panelId;
}

