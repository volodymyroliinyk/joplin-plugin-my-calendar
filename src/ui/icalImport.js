// src/ui/icalImport.js

(function () {
    function el(tag, attrs = {}, children = []) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
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

    function normPath(raw) {
        let p = (raw || "").trim();
        // Remove quotes if user pasted "/path/file.ics"
        p = p.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
        return p;
    }

    function init() {
        const root = document.getElementById("ical-root");
        if (!root) return;

        // UI
        const logBox = el("div", {
            id: "mc-imp-log",
            style:
                "margin-top:8px; padding:6px; border:1px dashed var(--joplin-divider-color);" +
                "max-height:220px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px;"
        });

        function log(...args) {
            const line = args
                .map(a => (typeof a === "object" ? JSON.stringify(a) : String(a)))
                .join(" ");
            console.log("[MyCalendar Import]", ...args);
            const div = document.createElement("div");
            div.textContent = line;
            logBox.appendChild(div);
            logBox.scrollTop = logBox.scrollHeight;
        }

        // ---- Notebook selector (dropdown) ----
        const LS_KEY = "mycalendar.targetFolderId";

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
            id: "ical-file",
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
                            name: "icalImport",
                            mode: "text",
                            ics: text,
                            source: `filepicker:${f.name}`,
                            targetFolderId: folderSelect.value || undefined,
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


        // Render
        root.innerHTML = "";
        root.appendChild(folderRow);
        root.appendChild(rowFile);

        root.appendChild(el("div", {style: "font-weight:600;margin-top:10px"}, ["Debug log"]));
        root.appendChild(logBox);

        // Ask plugin for folder tree
        window.webviewApi?.postMessage?.({name: "requestFolders"});


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

            if (msg.name === "folders") {
                populateFolders(msg.folders);
                // If you have log() - you can log
                // log("[FOLDERS]", `loaded=${(msg.folders || []).length}`);
                return;
            }
        });

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
