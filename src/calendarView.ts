import joplin from 'api';

// src/calendarView.ts
export async function createCalendarPanel(joplin: any): Promise<string> {
    const panelId = await joplin.views.panels.create('mycalendarPanel');

    await joplin.views.panels.setHtml(panelId, `
  <div id="cal-root" style="padding:10px;font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial">
    <div id="mc-toolbar">
      <!-- буде згенеровано скриптом -->
    </div>
    <div id="mc-grid">
      <!-- сітка днів -->
    </div>
    <div id="mc-events">
      <div class="mc-events-header">Події дня</div>
      <ul id="mc-events-list"></ul>
    </div>
  </div>
`);


    await joplin.views.panels.addScript(panelId, './ui/calendar.css');
    await joplin.views.panels.addScript(panelId, './ui/calendar.js');
    await joplin.views.panels.show(panelId);
    console.log('[MyCalendar] calendarView created');

    return panelId;
}

