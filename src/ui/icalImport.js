// [MyCalendar Import UI]
(function () {
    const root = document.getElementById('ical-root') || (function () {
        const div = document.createElement('div');
        div.id = 'ical-root';
        div.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial';
        div.style.padding = '8px';
        div.style.color = 'var(--joplin-color)';
        document.body.appendChild(div);
        return div;
    })();

    const section = document.createElement('div');
    section.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">ICS import</div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
      <input id="ical-path" type="text" placeholder="Absolute path to .ics (desktop only)"
             style="flex:1; padding:6px; border:1px solid var(--joplin-divider-color); background:var(--joplin-background-color); color:var(--joplin-color);">
      <button id="btn-import-file" style="padding:6px 10px;">Import file</button>
    </div>

    <div style="margin:8px 0; opacity:.7;">OR paste ICS content below:</div>
    <textarea id="ical-text" rows="10"
      style="width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--joplin-divider-color);
             background:var(--joplin-background-color); color:var(--joplin-color); white-space:pre;"></textarea>

    <div style="margin-top:8px; display:flex; gap:8px;">
      <button id="btn-import-text" style="padding:6px 10px;">Import text</button>
      <button id="btn-clear" style="padding:6px 10px;">Clear</button>
    </div>

    <div id="ical-status" style="margin-top:10px; font-size:12px;"></div>
  `;
    root.appendChild(section);

    const $ = (id) => section.querySelector(id);
    const statusEl = $('#ical-status');

    function logStatus(line) {
        const p = document.createElement('div');
        p.textContent = line;
        statusEl.appendChild(p);
    }

    // ---- Desktop webview messaging API
    const post = (msg) => {
        try {
            // Joplin webview API
            // eslint-disable-next-line no-undef
            return webviewApi.postMessage(msg);
        } catch (e) {
            console.error('[MyCalendar Import UI] postMessage failed', e);
        }
    };

    // ---- Listen to replies from main
    // eslint-disable-next-line no-undef
    webviewApi.onMessage((message) => {
        if (!message) return;
        if (message.name === 'importStatus') {
            logStatus(message.text || '');
        } else if (message.name === 'importDone') {
            logStatus(`Done. Added: ${message.added}, Updated: ${message.updated}, Skipped: ${message.skipped}, Errors: ${message.errors}`);
        } else if (message.name === 'importError') {
            logStatus(`ERROR: ${message.error || 'Unknown error'}`);
        }
    });

    // ---- Buttons
    $('#btn-import-file').addEventListener('click', () => {
        const path = $('#ical-path').value.trim();
        statusEl.innerHTML = '';
        logStatus('Importing… initialized');
        if (!path) {
            logStatus('ERROR: Path is empty');
            return;
        }
        post({name: 'icalImport', mode: 'file', path});
    });

    $('#btn-import-text').addEventListener('click', () => {
        const ics = $('#ical-text').value;
        statusEl.innerHTML = '';
        logStatus('Importing… initialized');
        if (!ics || !ics.trim()) {
            logStatus('ERROR: ICS text is empty');
            return;
        }
        post({name: 'icalImport', mode: 'text', ics});
    });

    $('#btn-clear').addEventListener('click', () => {
        $('#ical-text').value = '';
        statusEl.innerHTML = '';
    });
})();
