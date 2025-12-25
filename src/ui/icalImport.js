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
        // прибрати лапки, якщо користувач вставив "/path/file.ics"
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
                "max-height:220px; overflow:auto; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px;"
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

        const title = el("div", {style: "font-weight:700;margin-bottom:6px"}, ["ICS import"]);

        // 1) Paste text
        const ta = el("textarea", {
            id: "ical-text",
            placeholder: "Paste ICS content here…",
            style:
                "width:100%; min-height:120px; padding:6px; border:1px solid var(--joplin-divider-color);" +
                "background:var(--joplin-background-color); color:var(--joplin-color); resize:vertical;"
        });

        const btnImportText = el(
            "button",
            {
                style: "padding:6px 10px;", onclick: async () => {
                    const text = (ta.value || "").trim();
                    if (!text) return log("Paste ICS content first.");
                    log("Importing via TEXT…", "len=", text.length);
                    window.webviewApi?.postMessage?.({name: "icalImport", mode: "text", ics: text, source: "paste"});
                }
            },
            ["Import pasted text"]
        );

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
                            source: `filepicker:${f.name}`
                        });
                    };
                    reader.readAsText(f);
                }
            },
            ["Import selected file"]
        );

        // 3) Absolute path (desktop)
        const pathInput = el("input", {
            id: "ical-path",
            type: "text",
            placeholder: "Absolute path to .ics (desktop only)",
            style:
                "flex:1; padding:6px; border:1px solid var(--joplin-divider-color);" +
                "background:var(--joplin-background-color); color:var(--joplin-color);"
        });

        const btnImportPath = el(
            "button",
            {
                style: "padding:6px 10px;", onclick: async () => {
                    const raw = pathInput.value;
                    const p = normPath(raw);
                    log("Importing via PATH… initialized");
                    log("Path (raw):", raw);
                    log("Path (normalized):", p);
                    if (!p) return log("Path is empty.");
                    window.webviewApi?.postMessage?.({name: "icalImport", mode: "file", path: p});
                }
            },
            ["Import path"]
        );

        const rowFile = el("div", {style: "display:flex; gap:8px; align-items:center; margin:8px 0;"}, [
            fileInput,
            btnImportFile
        ]);

        const rowPath = el("div", {style: "display:flex; gap:8px; align-items:center; margin:8px 0;"}, [
            pathInput,
            btnImportPath
        ]);

        const rowTextBtn = el("div", {style: "display:flex; gap:8px; align-items:center; margin:8px 0;"}, [
            btnImportText
        ]);

        // Render
        root.innerHTML = "";
        root.appendChild(title);
        root.appendChild(el("div", {style: "font-weight:600;margin-top:8px"}, ["Paste ICS"]));
        root.appendChild(ta);
        root.appendChild(rowTextBtn);

        root.appendChild(el("div", {style: "font-weight:600;margin-top:10px"}, ["File picker (recommended)"]));
        root.appendChild(rowFile);

        root.appendChild(el("div", {style: "font-weight:600;margin-top:10px"}, ["Absolute path (desktop)"]));
        root.appendChild(rowPath);

        root.appendChild(el("div", {style: "font-weight:600;margin-top:10px"}, ["Debug log"]));
        root.appendChild(logBox);

        // Messages from backend
        window.webviewApi?.onMessage?.((ev) => {
            const msg = ev && ev.message ? ev.message : ev;
            if (!msg || !msg.name) return;

            if (msg.name === "importStatus") {
                log("[STATUS]", msg.text);
            } else if (msg.name === "importDone") {
                log("[DONE]", `added=${msg.added} updated=${msg.updated} skipped=${msg.skipped} errors=${msg.errors}`);
            } else if (msg.name === "importError") {
                log("[ERROR]", msg.error || "unknown");
            } else {
                log("[UI] unknown message:", msg);
            }
        });

        log("initialized");
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
