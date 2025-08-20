import joplin from 'api';

// src/calendarView.ts
export async function createCalendarPanel(joplin: any): Promise<string> {
    const panelId = await joplin.views.panels.create('mycalendarPanel');

    await joplin.views.panels.setHtml(panelId, `
  <div id="cal-root">
    <div id="mc-toolbar"></div>
    <div id="mc-grid"></div>
    <div id="mc-events">
      <div class="mc-events-header">Today events</div>
      <ul id="mc-events-list"></ul>
    </div>
<!--    <div id="mc-log" style="margin-top:8px;padding:6px;border:1px dashed var(&#45;&#45;joplin-divider-color);border-radius:6px;font-size:12px;opacity:.8;"></div>-->
  </div>
`);


    await joplin.views.panels.addScript(panelId, './ui/calendar.css');
    await joplin.views.panels.addScript(panelId, './ui/calendar.js');
    await joplin.views.panels.show(panelId);
    console.log('[MyCalendar] calendarView created');

    return panelId;
}

