// src/ui/icsImport.js
(function () {
    'use strict';

    // Single shared settings object across all UI scripts.
    window.__mcUiSettings = window.__mcUiSettings || {
        weekStart: 'monday',
        debug: undefined,
        // new multi-link format
        icsExportLinks: [],
    };
    const uiSettings = window.__mcUiSettings;

    const IDS = {
        root: 'ics-root',
        targetFolder: 'mc-target-folder',
        fileInput: 'ics-file',
        exportLinkBox: 'mc-ics-export-link',
        logBox: 'mc-imp-log',
    };

    const LS = {
        targetFolderId: 'mycalendar.targetFolderId',
        preserveLocalColor: 'mycalendar_preserve_local_color',
        importColorEnabled: 'mycalendar_import_color_enabled',
        importColorValue: 'mycalendar_import_color_value',
    };

    function safeGetLS(key, fallback = '') {
        try {
            const v = localStorage.getItem(key);
            return v == null ? fallback : v;
        } catch {
            return fallback;
        }
    }

    function safeSetLS(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // ignore
        }
    }

    function sanitizeExternalUrl(input) {
        const s = String(input ?? '').trim();
        if (!s) return '';
        try {
            const u = new URL(s);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
            return u.toString();
        } catch {
            return '';
        }
    }

    function el(tag, attrs = {}, children = []) {
        const n = document.createElement(tag);

        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null) continue;

            if (k === 'style') {
                n.setAttribute('style', String(v));
                continue;
            }
            if (k === 'class') {
                n.className = String(v);
                continue;
            }

            // Better handling for common element properties (best practice for inputs)
            if (k === 'checked') {
                n.checked = Boolean(v);
                if (Boolean(v)) n.setAttribute('checked', 'checked');
                continue;
            }
            if (k === 'disabled') {
                n.disabled = Boolean(v);
                if (Boolean(v)) n.setAttribute('disabled', 'disabled');
                continue;
            }
            if (k === 'value') {
                n.value = String(v);
                continue;
            }

            if (k.startsWith('on') && typeof v === 'function') {
                n.addEventListener(k.slice(2), v);
                continue;
            }

            n.setAttribute(k, String(v));
        }

        for (const c of children) {
            if (c == null) continue;
            if (typeof c === 'string') n.appendChild(document.createTextNode(c));
            else n.appendChild(c);
        }

        return n;
    }

    function createUiLogger(prefix) {
        let outputBox = null;

        function setOutputBox(el) {
            outputBox = el || null;
        }

        function isDebugEnabled() {
            return uiSettings.debug === true;
        }

        function forwardToMain(level, args) {
            try {
                if (!isDebugEnabled()) return;

                const pm = window.webviewApi?.postMessage;
                if (typeof pm !== 'function') return;

                const safeArgs = (args || []).map((a) => {
                    if (a && typeof a === 'object' && a.message && a.stack) {
                        return {__error: true, message: a.message, stack: a.stack};
                    }
                    if (typeof a === 'string') return a;
                    try {
                        return JSON.stringify(a);
                    } catch {
                        return String(a);
                    }
                });

                pm({name: 'uiLog', source: 'icsImport', level, args: safeArgs});
            } catch {
                // ignore
            }
        }

        function appendToBox(args) {
            if (!outputBox) return;
            if (!isDebugEnabled()) return;

            try {
                const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
                const div = document.createElement('div');
                div.textContent = line;
                outputBox.appendChild(div);
                outputBox.scrollTop = outputBox.scrollHeight;
            } catch {
                // ignore
            }
        }

        function write(consoleFn, args) {
            if (args.length > 0 && typeof args[0] === 'string') {
                const [msg, ...rest] = args;
                consoleFn(`${prefix} ${msg}`, ...rest);
            } else {
                consoleFn(prefix, ...args);
            }

            appendToBox(args);
        }

        return {
            setOutputBox,
            log: (...args) => {
                write(console.log, args);
                forwardToMain('log', args);
            },
            info: (...args) => {
                write(console.log, args);
                forwardToMain('info', args);
            },
            debug: (...args) => {
                write(console.log, args);
                forwardToMain('debug', args);
            },
            warn: (...args) => {
                write(console.warn, args);
                forwardToMain('warn', args);
            },
            error: (...args) => {
                write(console.error, args);
                forwardToMain('error', args);
            },
        };
    }

    // Expose for unit tests even if #ics-root is missing
    const uiLogger =
        window.__mcImportLogger || (window.__mcImportLogger = createUiLogger('[MyCalendar Import]'));

    function mcRegisterOnMessage(handler) {
        window.__mcMsgHandlers = window.__mcMsgHandlers || [];
        window.__mcMsgHandlers.push(handler);

        if (window.__mcMsgDispatcherInstalled) return;
        window.__mcMsgDispatcherInstalled = true;

        if (window.webviewApi?.onMessage) {
            window.webviewApi.onMessage((ev) => {
                const msg = ev && ev.message ? ev.message : ev;
                for (const h of window.__mcMsgHandlers) {
                    try {
                        h(msg);
                    } catch (e) {
                        uiLogger.error('handler error', e);
                    }
                }
            });
        }
    }

    function init() {
        const root = document.getElementById(IDS.root);
        if (!root) return;

        const logBox = el('div', {
            id: IDS.logBox,
            style:
                'margin-top:8px; padding:6px; border:1px dashed var(--joplin-divider-color);' +
                'max-height:220px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px;',
        });

        uiLogger.setOutputBox(logBox);

        const debugHeader = el('div', {style: 'font-weight:600;margin-top:10px'}, ['Debug log']);
        const exportLinkBox = el('div', {id: IDS.exportLinkBox, style: 'margin-top:10px'});

        function renderExportLinks() {
            exportLinkBox.textContent = '';

            // Normalize incoming settings (support both new and legacy field)
            const rawLinks = Array.isArray(uiSettings.icsExportLinks) ? uiSettings.icsExportLinks : [];
            const links = [];

            for (const it of rawLinks) {
                if (!it) continue;
                const url = sanitizeExternalUrl(it.url);
                if (!url) continue;
                const title = String(it.title ?? '').trim();
                links.push({title, url});
            }

            if (!links.length) return;

            const label = el('div', {style: 'font-weight:600;margin-bottom:6px'}, ['ICS export links']);
            const btnRow = el('div', {style: 'display:flex; gap:6px; flex-wrap:wrap;'}, []);

            links.forEach((l, idx) => {
                const text = (l.title || '').trim() || `Link ${idx + 1}`;
                // Use <a> styled as a button (more reliable inside webviews)
                const a = el(
                    'a',
                    {
                        href: l.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        class: 'mc-setting-btn',
                        style: 'text-decoration:none;',
                    },
                    [text],
                );
                btnRow.appendChild(a);
            });

            exportLinkBox.appendChild(label);
            exportLinkBox.appendChild(btnRow);
        }

        function applyDebugUI() {
            // Keep export link near bottom (above Debug log when enabled)
            if (exportLinkBox.parentNode) root.removeChild(exportLinkBox);
            renderExportLinks();
            if (exportLinkBox.childNodes.length) root.appendChild(exportLinkBox);

            if (debugHeader.parentNode) root.removeChild(debugHeader);
            if (logBox.parentNode) root.removeChild(logBox);

            if (uiSettings.debug === true) {
                root.appendChild(debugHeader);
                root.appendChild(logBox);
            }
        }

        // ---- Notebook selector (dropdown) ----
        const folderSelect = el('select', {
            id: IDS.targetFolder,
            class: 'mc-setting-select-control',
            style: 'flex:1;width:100%;',
        });

        // Render
        root.innerHTML = '';

        // Wrap import controls in a <form> so this section is semantically a form,
// BUT keep it AJAX-only: never allow a real submit/navigation.
        const importForm = el('form', {
            id: 'mc-ics-import-form',
            style: 'margin:0; padding:0;',
            onsubmit: (e) => {
                // Critical for Joplin webviews: prevent full iframe reload
                e.preventDefault();
                e.stopPropagation();
                // void doImportFromPicker();
            },
        });

        // Reload button MUST be type="button"
        const btnReloadFolders = el(
            'button',
            {
                type: 'button',
                style: 'padding:6px 10px;',
                class: 'mc-setting-btn',
                onclick: () => window.webviewApi?.postMessage?.({name: 'requestFolders'}),
            },
            ['Reload'],
        );

        const folderRow = el('div', {style: 'display:flex; gap:8px; align-items:center; margin:8px 0;'}, [
            el('div', {style: 'font-weight:600;'}, ['Target notebook']),
            folderSelect,
            btnReloadFolders,
        ]);

        folderSelect.addEventListener('change', () => {
            safeSetLS(LS.targetFolderId, folderSelect.value || '');
        });

        function populateFolders(list) {
            const desired = safeGetLS(LS.targetFolderId, '');

            folderSelect.innerHTML = '';

            // Placeholder
            folderSelect.appendChild(el('option', {value: '', disabled: true}, ['Select a notebook…']));

            for (const f of list || []) {
                const prefix = f.depth ? '- '.repeat(Math.min(10, f.depth)) : '';
                folderSelect.appendChild(el('option', {value: f.id}, [prefix + f.title]));
            }

            const hasDesired = desired && Array.from(folderSelect.options).some((o) => o.value === desired);
            if (hasDesired) folderSelect.value = desired;
            else if (folderSelect.options.length > 1) folderSelect.selectedIndex = 1;

            if (!folderSelect.value && folderSelect.options.length > 1) folderSelect.selectedIndex = 1;
        }

        // 2) File picker
        const fileInput = el('input', {
            id: IDS.fileInput,
            type: 'file',
            accept: '.ics,text/calendar',
            style: 'flex:1;',
        });

        // Preserve local color (default ON)
        let preserveLocalColor = safeGetLS(LS.preserveLocalColor, '1') !== '0';

        // Default import color (default OFF)
        let importColorEnabled = safeGetLS(LS.importColorEnabled, '0') === '1';
        let importColorValue = safeGetLS(LS.importColorValue, '#1470d9');
        if (!/^#[0-9a-fA-F]{6}$/.test(importColorValue)) importColorValue = '#1470d9';

        const importColorPicker = el('input', {
            type: 'color',
            value: importColorValue,
            disabled: !importColorEnabled,
            onchange: () => {
                importColorValue = String(importColorPicker.value || '').trim();
                safeSetLS(LS.importColorValue, importColorValue);
            },
        });

        let importInProgress = false;

        async function doImportFromPicker() {
            if (importInProgress) return;

            const f = fileInput.files && fileInput.files[0];
            if (!f) return uiLogger.log('No file selected.');

            const targetFolderId = String(folderSelect.value || '').trim();
            if (!targetFolderId) return uiLogger.log('Select a target notebook first.');

            importInProgress = true;
            btnImportFile.disabled = true;
            fileInput.disabled = true;
            folderSelect.disabled = true;

            const finish = () => {
                importInProgress = false;
                btnImportFile.disabled = false;
                fileInput.disabled = false;
                folderSelect.disabled = false;
            };

            try {
                const reader = new FileReader();

                reader.onerror = () => {
                    uiLogger.error('FileReader error:', reader.error?.message || reader.error);
                    finish();
                };

                reader.onload = () => {
                    const text = String(reader.result || '');
                    window.webviewApi?.postMessage?.({
                        name: 'icsImport',
                        mode: 'text',
                        ics: text,
                        source: `filepicker:${f.name}`,
                        targetFolderId,
                        preserveLocalColor,
                        importDefaultColor: importColorEnabled ? importColorValue : undefined,
                    });

                    // Re-enable right after posting (AJAX-only; backend reports progress via messages)
                    finish();
                };

                reader.readAsText(f);
            } catch (e) {
                uiLogger.error('Import failed:', e);
                finish();
            }
        }

        // Import button MUST be type="button"
        const btnImportFile = el(
            'button',
            {
                type: 'button',
                style: 'padding:6px 10px;',
                class: 'mc-setting-btn',
                onclick: () => void doImportFromPicker(),
            },
            ['Import'],
        );


        const rowFile = el('div', {style: 'display:flex; gap:8px; align-items:center; margin:8px 0;'}, [
            el('div', {style: 'font-weight:600;'}, ['.ics file']),
            fileInput,
            btnImportFile,
        ]);

        const preserveColorInput = el('input', {
            type: 'checkbox',
            checked: preserveLocalColor,
            onchange: () => {
                preserveLocalColor = !!preserveColorInput.checked;
                safeSetLS(LS.preserveLocalColor, preserveLocalColor ? '1' : '0');
            },
        });

        const importColorEnabledInput = el('input', {
            type: 'checkbox',
            checked: importColorEnabled,
            onchange: () => {
                importColorEnabled = !!importColorEnabledInput.checked;
                importColorPicker.disabled = !importColorEnabled;
                safeSetLS(LS.importColorEnabled, importColorEnabled ? '1' : '0');
            },
        });

        const optionsRow = el('div', {style: 'display:flex; flex-direction:column; gap:6px; margin:8px 0;'}, [
            el('div', {style: 'font-weight:600;'}, ['Options']),
            el('label', {style: 'display:flex; align-items:center; gap:8px; cursor:pointer;'}, [
                preserveColorInput,
                el('span', {}, ['Preserve local color on re-import']),
            ]),
            el('label', {style: 'display:flex; align-items:center; gap:8px; cursor:pointer;'}, [
                importColorEnabledInput,
                el('span', {}, ['Set default color for imported events without color']),
            ]),
            el('div', {style: 'display:flex; align-items:center; gap:8px; margin-left:24px;'}, [
                importColorPicker,
                el('span', {style: 'opacity:0.85;'}, ['Default import color']),
            ]),
        ]);


        importForm.appendChild(folderRow);
        importForm.appendChild(rowFile);
        importForm.appendChild(optionsRow);
        root.appendChild(importForm);

        applyDebugUI();

        // Messages from backend
        mcRegisterOnMessage((msg) => {
            if (!msg || !msg.name) return;

            switch (msg.name) {
                case 'uiSettings': {
                    if (typeof msg.debug === 'boolean') uiSettings.debug = msg.debug;
                    if (Array.isArray(msg.icsExportLinks)) uiSettings.icsExportLinks = msg.icsExportLinks;
                    applyDebugUI();
                    return;
                }

                case 'importStatus':
                    uiLogger.log('[STATUS]', msg.text);
                    return;

                case 'importDone':
                    uiLogger.log(
                        '[DONE]',
                        `added=${msg.added} updated=${msg.updated} skipped=${msg.skipped} errors=${msg.errors}`,
                    );
                    importInProgress = false;
                    btnImportFile.disabled = false;
                    fileInput.disabled = false;
                    folderSelect.disabled = false;
                    return;

                case 'importError':
                    uiLogger.log('[ERROR]', msg.error || 'unknown');
                    importInProgress = false;
                    btnImportFile.disabled = false;
                    fileInput.disabled = false;
                    folderSelect.disabled = false;
                    return;

                case 'folders':
                    populateFolders(msg.folders);
                    return;

                default:
                    return;
            }
        });

        // Ask plugin for settings + folder tree (send AFTER handler is installed)
        window.webviewApi?.postMessage?.({name: 'uiReady'});
        window.webviewApi?.postMessage?.({name: 'requestFolders'});

        uiLogger.debug('initialized');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
