// src/ui/icsImport.js

(function () {
    // Ensure a single shared settings object across all UI scripts.
    window.__mcUiSettings = window.__mcUiSettings || {weekStart: 'monday', debug: undefined};
    const uiSettings = window.__mcUiSettings;

    function el(tag, attrs = {}, children = []) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null) continue;   // <-- FIX

            if (k === "style") n.setAttribute("style", v);
            else if (k === "class") n.className = v;
            else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, String(v));
        }
        for (const c of children) {
            if (c == null) continue;
            if (typeof c === "string") n.appendChild(document.createTextNode(c));
            else n.appendChild(c);
        }
        return n;
    }

    function init() {
        const root = document.getElementById("ics-root");
        if (!root) return;

        let debug = false

        // UI
        const logBox = el("div", {
            id: "mc-imp-log",
            style:
                "margin-top:8px; padding:6px; border:1px dashed var(--joplin-divider-color);" +
                "max-height:220px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px;"
        });
        const debugHeader = el("div", {style: "font-weight:600;margin-top:10px"}, ["Debug log"]);

        function log(...args) {
            if (uiSettings.debug !== true) return;

            const line = args
                .map(a => (typeof a === "object" ? JSON.stringify(a) : String(a)))
                .join(" ");
            if (uiSettings.debug) console.log("[MyCalendar Import]", ...args);
            const div = document.createElement("div");
            div.textContent = line;
            if (uiSettings.debug) {
                logBox.appendChild(div);
                logBox.scrollTop = logBox.scrollHeight;
            }
        }

        function applyDebugUI() {
            if (debugHeader.parentNode) root.removeChild(debugHeader);
            if (logBox.parentNode) root.removeChild(logBox);

            if (uiSettings.debug) {
                root.appendChild(debugHeader);
                root.appendChild(logBox);
            }
        }

        // ---- Notebook selector (dropdown) ----
        const LS_KEY = "mycalendar.targetFolderId";
        const LS_PRESERVE_COLOR_KEY = "mycalendar_preserve_local_color";
        const LS_IMPORT_COLOR_ENABLED_KEY = "mycalendar_import_color_enabled";
        const LS_IMPORT_COLOR_VALUE_KEY = "mycalendar_import_color_value";

        const folderSelect = el("select", {
            id: "mc-target-folder",
            class: "mc-setting-select-control",
            style: "flex:1;width:100%;"
        });

// Reload button (optional)
        const btnReloadFolders = el("button", {
            style: "padding:6px 10px;",
            class: "mc-setting-btn",
            onclick: () => window.webviewApi?.postMessage?.({name: "requestFolders"})
        }, ["Reload"]);

        const folderRow = el("div", {style: "display:flex; gap:8px; align-items:center; margin:8px 0;"}, [
            el("div", {style: "font-weight:600;"}, ["Target notebook"]),
            folderSelect,
            btnReloadFolders,
        ]);

        folderSelect.addEventListener("change", () => {
            try {
                localStorage.setItem(LS_KEY, folderSelect.value || "");
            } catch (e) {
            }
        });

        function populateFolders(list) {
            let desired = "";
            try {
                desired = localStorage.getItem(LS_KEY) || "";
            } catch (e) {
            }

            folderSelect.innerHTML = "";

            // Placeholder
            const placeholder = el("option", {value: "", disabled: "true"}, ["Select a notebook…"]);
            folderSelect.appendChild(placeholder);

            for (const f of (list || [])) {
                const prefix = f.depth ? ("- ".repeat(Math.min(10, f.depth))) : "";
                const opt = el("option", {value: f.id}, [prefix + f.title]);
                folderSelect.appendChild(opt);
            }

            // restore selection or pick first real folder
            const hasDesired = desired && Array.from(folderSelect.options).some(o => o.value === desired);
            if (hasDesired) folderSelect.value = desired;
            else if (folderSelect.options.length > 1) folderSelect.selectedIndex = 1;

            if (!folderSelect.value && folderSelect.options.length > 1) folderSelect.selectedIndex = 1;
        }


        // 2) File picker (recommended)
        const fileInput = el("input", {
            id: "ics-file",
            type: "file",
            accept: ".ics,text/calendar",
            style: "flex:1;"
        });

        const btnImportFile = el(
            "button",
            {
                style: "padding:6px 10px;", onclick: async () => {
                    const f = fileInput.files && fileInput.files[0];
                    if (!f) return log("No file selected.");
                    log("Reading file via FileReader…", "name=", f.name, "size=", f.size);

                    const reader = new FileReader();
                    reader.onerror = () => log("FileReader error:", reader.error?.message || reader.error);
                    reader.onload = () => {
                        const text = String(reader.result || "");
                        log("File read OK. Importing…", "len=", text.length);
                        window.webviewApi?.postMessage?.({
                            name: "icsImport",
                            mode: "text",
                            ics: text,
                            source: `filepicker:${f.name}`,
                            targetFolderId: folderSelect.value || undefined,
                            preserveLocalColor: preserveLocalColor,
                            importDefaultColor: importColorEnabled ? importColorValue : undefined,
                        });
                    };
                    reader.readAsText(f);
                },
                class: "mc-setting-btn",
            },
            ["Import"]
        );


        const rowFile = el("div", {style: "display:flex; gap:8px; align-items:center; margin:8px 0;"}, [
            el("div", {style: "font-weight:600;"}, [".ics file"]),
            fileInput,
            btnImportFile
        ]);

        // Preserve local color (default ON)
        let preserveLocalColor = true;
        try {
            const v = localStorage.getItem(LS_PRESERVE_COLOR_KEY);
            if (v === "0") preserveLocalColor = false;
        } catch (e) {
        }

        const preserveColorInput = el("input", {
            type: "checkbox",
            checked: preserveLocalColor ? "true" : undefined,
            onchange: () => {
                preserveLocalColor = !!preserveColorInput.checked;
                try {
                    localStorage.setItem(LS_PRESERVE_COLOR_KEY, preserveLocalColor ? "1" : "0");
                } catch (e) {
                }
            }
        });

        // Default import color (default OFF)
        let importColorEnabled = false;
        let importColorValue = "#1470d9";

        try {
            const en = localStorage.getItem(LS_IMPORT_COLOR_ENABLED_KEY);
            if (en === "1") importColorEnabled = true;
            const cv = localStorage.getItem(LS_IMPORT_COLOR_VALUE_KEY);
            if (cv && /^#[0-9a-fA-F]{6}$/.test(cv)) importColorValue = cv;
        } catch (e) {
        }

        const importColorEnabledInput = el("input", {
            type: "checkbox",
            checked: importColorEnabled ? "true" : undefined,
            onchange: () => {
                importColorEnabled = !!importColorEnabledInput.checked;
                importColorPicker.disabled = !importColorEnabled;
                try {
                    localStorage.setItem(LS_IMPORT_COLOR_ENABLED_KEY, importColorEnabled ? "1" : "0");
                } catch (e) {
                }
            }
        });

        const importColorPicker = el("input", {
            type: "color",
            value: importColorValue,
            disabled: importColorEnabled ? undefined : "true",
            onchange: () => {
                importColorValue = String(importColorPicker.value || "").trim();
                try {
                    localStorage.setItem(LS_IMPORT_COLOR_VALUE_KEY, importColorValue);
                } catch (e) {
                }
            }
        });

// Options row
        const optionsRow = el("div", {style: "display:flex; flex-direction:column; gap:6px; margin:8px 0;"}, [
            el("div", {style: "font-weight:600;"}, ["Options"]),

            el("label", {style: "display:flex; align-items:center; gap:8px; cursor:pointer;"}, [
                preserveColorInput,
                el("span", {}, ["Preserve local color on re-import"])
            ]),

            el("label", {style: "display:flex; align-items:center; gap:8px; cursor:pointer;"}, [
                importColorEnabledInput,
                el("span", {}, ["Set default color for imported events without color"])
            ]),

            el("div", {style: "display:flex; align-items:center; gap:8px; margin-left:24px;"}, [
                importColorPicker,
                el("span", {style: "opacity:0.85;"}, ["Default import color"])
            ])
        ]);

        // Render
        root.innerHTML = "";
        root.appendChild(folderRow);
        root.appendChild(rowFile);
        root.appendChild(optionsRow);

        applyDebugUI();

        // // Ask plugin for settings + folder tree
        // window.webviewApi?.postMessage?.({name: "uiReady"});
        // window.webviewApi?.postMessage?.({name: "requestFolders"});


        // Messages from backend
        mcRegisterOnMessage((msg) => {
            if (!msg || !msg.name) return;

            if (msg.name === "importStatus") {
                log("[STATUS]", msg.text);
            } else if (msg.name === "importDone") {
                log("[DONE]", `added=${msg.added} updated=${msg.updated} skipped=${msg.skipped} errors=${msg.errors}`);
            } else if (msg.name === "importError") {
                log("[ERROR]", msg.error || "unknown");
            }


            if (msg.name === "uiSettings") {
                if (typeof msg.debug === "boolean") {
                    uiSettings.debug = msg.debug;
                    applyDebugUI();
                }
                return;
            }


            if (msg.name === "folders") {
                populateFolders(msg.folders);
                // If you have log() - you can log
                // log("[FOLDERS]", `loaded=${(msg.folders || []).length}`);
                return;
            }
        });

        // Ask plugin for settings + folder tree (send AFTER handler is installed)
        window.webviewApi?.postMessage?.({name: "uiReady"});
        window.webviewApi?.postMessage?.({name: "requestFolders"});

        log("initialized");
    }

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
                        console.error('[MyCalendar] handler error', e);
                    }
                }
            });
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
