/**
 * html.js — Web UI example for the Logineo LMS client.
 *
 * A tiny Express server that exposes the functions from ./index.js over a
 * small JSON API and serves a single, self-contained HTML page.
 *
 * Run:  node html.js   (then open http://localhost:3000)
 *
 * Note: the client keeps one in-memory session per Node process. That is fine
 * for a local demo, but it is not multi-user safe. Do not deploy this as-is.
 * ALSO VIBECODED. JUST THIS ONE FILE.
 */

import express from "express";
import moodle from "./index.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const session = {
    configured: false,
    serverUrl: null,
    username: null,
    cookie: null,
    sesskey: null,
};

function isLoggedIn() {
    return Boolean(session.cookie && session.sesskey);
}

function requireLogin(res) {
    if (!isLoggedIn()) {
        res.status(401).json({ error: "Nicht angemeldet. Bitte zuerst verbinden." });
        return false;
    }
    return true;
}

function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            res.status(500).json({ error: err?.message || String(err) });
        }
    };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get("/api/status", (req, res) => {
    res.json({
        configured: session.configured,
        serverUrl: session.serverUrl,
        username: session.username,
        loggedIn: isLoggedIn(),
    });
});

app.post("/api/configure", handle(async (req, res) => {
    const { serverUrl, allowUnsafe = false, debug = false } = req.body || {};

    if (!serverUrl) {
        throw new Error("Server-URL fehlt.");
    }

    let parsed;
    try {
        parsed = new URL(serverUrl);
    } catch {
        throw new Error("Ungültige Server-URL (inkl. http:// oder https://).");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Es werden nur http:// und https:// unterstützt.");
    }
    if (parsed.search || parsed.hash) {
        throw new Error("Die Server-URL darf keine Query-Parameter enthalten.");
    }

    const ok = moodle.configure({ serverUrl, allowUnsafe, debug });
    if (!ok) {
        throw new Error("Konfiguration fehlgeschlagen.");
    }

    session.configured = true;
    session.serverUrl = serverUrl;
    session.username = null;
    session.cookie = null;
    session.sesskey = null;

    res.json({ ok: true, serverUrl });
}));

app.post("/api/login", handle(async (req, res) => {
    const { username, password } = req.body || {};

    if (!session.configured) {
        throw new Error("Zuerst den Server konfigurieren.");
    }
    if (!username || !password) {
        throw new Error("Benutzername und Passwort erforderlich.");
    }

    const prerequisite = await moodle.getLoginPrerequisite();
    if (!prerequisite) {
        throw new Error("Login-Vorbereitung fehlgeschlagen (logintoken nicht gefunden).");
    }

    const cookie = await moodle.login(username, password, prerequisite.logintoken, prerequisite.initCookie);
    if (!cookie) {
        throw new Error("Login fehlgeschlagen. Zugangsdaten prüfen.");
    }

    const sesskey = await moodle.getSesskey(cookie);
    if (!sesskey) {
        throw new Error("Sitzungsschlüssel konnte nicht gelesen werden.");
    }

    session.cookie = cookie;
    session.sesskey = sesskey;
    session.username = username;

    res.json({ ok: true, username });
}));

app.post("/api/logout", (req, res) => {
    session.cookie = null;
    session.sesskey = null;
    session.username = null;
    res.json({ ok: true });
});

app.post("/api/courses", handle(async (req, res) => {
    if (!requireLogin(res)) return;

    const raw = await moodle.loadCourses(session.cookie, session.sesskey);
    if (!raw) {
        throw new Error("Kurse konnten nicht geladen werden.");
    }

    const parsed = JSON.parse(raw);

    if (parsed?.[0]?.error) {
        throw new Error(parsed[0].exception?.message || "Moodle meldet einen Fehler.");
    }

    res.json({ courses: parsed?.[0]?.data?.courses ?? [], raw: parsed });
}));

app.get("/api/course/:id", handle(async (req, res) => {
    if (!requireLogin(res)) return;
    const data = await moodle.getCourseData(session.cookie, req.params.id);
    if (!data) throw new Error("Kursdaten konnten nicht geladen werden.");
    res.json(data);
}));

app.get("/api/section/:id", handle(async (req, res) => {
    if (!requireLogin(res)) return;
    const data = await moodle.getCourseSections(session.cookie, req.params.id);
    if (!data) throw new Error("Abschnitt konnte nicht geladen werden.");
    res.json(data);
}));

app.get("/api/module/:id", handle(async (req, res) => {
    if (!requireLogin(res)) return;
    const data = await moodle.getCourseModule(session.cookie, req.params.id);
    if (!data) throw new Error("Aufgabe konnte nicht geladen werden.");
    res.json(data);
}));

app.get("/api/folder/:id", handle(async (req, res) => {
    if (!requireLogin(res)) return;
    const data = await moodle.getCourseSectionFolder(session.cookie, req.params.id);
    if (!data) throw new Error("Ordner konnte nicht geladen werden.");
    res.json(data);
}));

app.get("/api/notifications", handle(async (req, res) => {
    if (!requireLogin(res)) return;
    const data = await moodle.getNotifications(session.cookie, session.sesskey);
    if (!data) throw new Error("Mitteilungen konnten nicht geladen werden.");
    res.json(data);
}));

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Logineo LMS Client · Demo</title>
<style>
:root{
  --bg:#f4f5f7;
  --surface:#fff;
  --surface-2:#fafbfc;
  --border:#e2e5ea;
  --border-strong:#cfd4dc;
  --text:#181a1f;
  --muted:#6b7280;
  --accent:#2f6feb;
  --accent-weak:#eaf1fe;
  --ok:#157347;
  --ok-weak:#e6f4ec;
  --warn:#9a6700;
  --warn-weak:#fff4d6;
  --error:#b42318;
  --error-weak:#fdecea;
  --radius:8px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 var(--sans)}
a{color:var(--accent)}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
.brand{display:flex;align-items:center;gap:12px}
.brand-mark{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:#181a1f;color:#fff;font-weight:700;font-size:13px;letter-spacing:.04em}
.brand-text{display:flex;flex-direction:column;line-height:1.2}
.brand-text strong{font-size:15px}
.brand-text small{color:var(--muted);font-size:12px}
.pill{font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px}
.pill-idle{background:#eef0f3;color:#4b5563}
.pill-warn{background:var(--warn-weak);color:var(--warn)}
.pill-ok{background:var(--ok-weak);color:var(--ok)}
.layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;padding:20px 24px;max-width:1240px;margin:0 auto;align-items:start}
@media (max-width:900px){.layout{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.card+.card{margin-top:16px}
.card-title{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.field{display:block;margin-bottom:12px}
.field span{display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#374151}
input[type=text],input[type=url],input[type=password]{width:100%;padding:8px 10px;font:inherit;font-size:13px;border:1px solid var(--border-strong);border-radius:6px;background:#fff;color:var(--text)}
input:focus{outline:2px solid var(--accent-weak);border-color:var(--accent)}
.id-input{max-width:160px}
.options{display:flex;flex-direction:column;gap:6px;margin:4px 0 14px}
.checkbox{display:flex;align-items:center;gap:8px;font-size:13px;color:#374151}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{appearance:none;border:1px solid var(--border-strong);background:#fff;color:var(--text);padding:8px 14px;border-radius:6px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.btn:hover{background:var(--surface-2)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:#2860cf}
.btn:disabled{opacity:.55;cursor:default}
.link-btn{background:none;border:none;color:var(--accent);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline}
.msg{font-size:13px;margin:12px 0 0;padding:8px 10px;border-radius:6px}
.msg.info{background:#eef2f7;color:#374151}
.msg.ok{background:var(--ok-weak);color:var(--ok)}
.msg.error{background:var(--error-weak);color:var(--error)}
.kv{margin:14px 0 0;display:grid;gap:6px}
.kv>div{display:flex;justify-content:space-between;gap:12px;font-size:13px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;font-family:var(--mono);font-size:12px;text-align:right;word-break:break-all}
.kv.list{display:block;border-top:1px solid var(--border);margin-top:8px}
.kv.list>div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.kv.list dt{font-family:var(--sans)}
.note p{margin:0;font-size:12.5px;color:var(--muted)}
code{font-family:var(--mono);font-size:.9em;background:#eef0f3;padding:1px 4px;border-radius:4px}
.content{min-width:0}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
.tab{appearance:none;border:none;background:none;font:inherit;font-size:13px;font-weight:600;color:var(--muted);padding:9px 12px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.panel{display:none;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px}
.panel.active{display:block}
.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.panel-head h2{margin:0;font-size:16px}
.panel-head p{margin:4px 0 0;font-size:13px;color:var(--muted)}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.output{min-height:80px}
.output[aria-busy=true]{opacity:.6}
.empty{color:var(--muted);font-size:13px;margin:0}
.empty.error{color:var(--error)}
.result-meta{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.result-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.result-head h3{margin:0;font-size:15px}
.table-wrap{border:1px solid var(--border);border-radius:6px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
th{background:var(--surface-2);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tbody tr:last-child td{border-bottom:none}
tr.clickable{cursor:pointer}
tr.clickable:hover{background:var(--accent-weak)}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;background:#eef0f3;color:#4b5563}
.tag-ok{background:var(--ok-weak);color:var(--ok)}
.mono{font-family:var(--mono);font-size:12px}
.dim{color:var(--muted)}
.section{border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden}
.section summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;cursor:pointer;font-weight:600;font-size:13px;background:var(--surface-2);list-style:none}
.section summary::-webkit-details-marker{display:none}
.section[open] summary{border-bottom:1px solid var(--border)}
.activity-list{list-style:none;margin:0;padding:6px 12px}
.activity-list li{padding:6px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.activity-list li:last-child{border-bottom:none}
.activity-list a{text-decoration:none}
.activity-list a:hover{text-decoration:underline}
.file-list{list-style:none;margin:0 0 12px;padding:0}
.file-list li{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.file-list a{text-decoration:none;word-break:break-all}
.file-list a:hover{text-decoration:underline}
.file-list .dim{margin-left:auto;white-space:nowrap}
.sub{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:18px 0 8px}
.text-block{white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:12px;font-family:var(--mono);font-size:12.5px;margin:0;max-height:320px;overflow:auto}
.notice-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.notice-list li{border:1px solid var(--border);border-radius:6px;padding:10px 12px}
.notice-subject{font-weight:600;font-size:13px;margin-bottom:2px}
.notice-body{font-size:13px;color:#374151;margin-bottom:6px;white-space:pre-wrap}
.raw{margin-top:16px;border-top:1px solid var(--border);padding-top:10px}
.raw summary{cursor:pointer;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.raw pre{margin:10px 0 0;background:#1b1f24;color:#e6e6e6;border-radius:6px;padding:12px;font-size:12px;overflow:auto;max-height:360px}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="brand-mark">LN</span>
    <span class="brand-text">
      <strong>Logineo LMS Client</strong>
      <small>Web UI example</small>
    </span>
  </div>
  <span id="server-pill" class="pill pill-idle">Nicht konfiguriert</span>
</header>

<main class="layout">
  <aside class="sidebar">
    <section class="card">
      <h2 class="card-title">Verbindung</h2>
      <form id="connect-form" autocomplete="off">
        <label class="field">
          <span>Server-URL</span>
          <input id="server-url" type="url" placeholder="https://schule.logineonrw-lms.de" required />
        </label>
        <label class="field">
          <span>Benutzername</span>
          <input id="username" type="text" placeholder="vorname.name@schule.de" />
        </label>
        <label class="field">
          <span>Passwort</span>
          <input id="password" type="password" placeholder="••••••••" />
        </label>
        <div class="options">
          <label class="checkbox"><input id="allow-unsafe" type="checkbox" /><span>Unsichere Verbindung erlauben</span></label>
          <label class="checkbox"><input id="debug" type="checkbox" /><span>Debug-Ausgabe im Server</span></label>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary" id="login-btn">Verbinden</button>
          <button type="button" class="btn" id="logout-btn">Trennen</button>
        </div>
      </form>
      <p id="connect-msg" class="msg" hidden></p>
      <dl class="kv" id="session-info" hidden>
        <div><dt>Server</dt><dd id="info-server"></dd></div>
        <div><dt>Benutzer</dt><dd id="info-user"></dd></div>
      </dl>
    </section>
    <section class="card note">
      <h2 class="card-title">Hinweis</h2>
      <p>Diese Oberfläche spricht ausschließlich mit <code>index.js</code>. Zugangsdaten werden nicht gespeichert; die Sitzung liegt nur im Speicher des Node-Prozesses.</p>
    </section>
  </aside>

  <section class="content">
    <nav class="tabs" id="tabs">
      <button data-tab="courses" class="tab active">Kurse</button>
      <button data-tab="course" class="tab">Kursstruktur</button>
      <button data-tab="section" class="tab">Abschnitt</button>
      <button data-tab="module" class="tab">Aufgabe</button>
      <button data-tab="folder" class="tab">Ordner</button>
      <button data-tab="notifications" class="tab">Mitteilungen</button>
    </nav>

    <div class="panel active" data-panel="courses">
      <div class="panel-head">
        <div>
          <h2>Kurse</h2>
          <p>Alle eingeschriebenen Kurse laden (<code>loadCourses</code>).</p>
        </div>
        <div class="toolbar">
          <button class="btn primary" id="load-courses">Kurse laden</button>
        </div>
      </div>
      <div class="output" id="out-courses"><p class="empty">Noch keine Daten geladen.</p></div>
    </div>

    <div class="panel" data-panel="course">
      <div class="panel-head">
        <div>
          <h2>Kursstruktur</h2>
          <p>Abschnitte und Aktivitäten eines Kurses (<code>getCourseData</code>).</p>
        </div>
        <div class="toolbar">
          <input class="id-input" id="course-id" type="text" inputmode="numeric" placeholder="Kurs-ID" />
          <button class="btn primary" id="load-course">Laden</button>
        </div>
      </div>
      <div class="output" id="out-course"><p class="empty">Kurs-ID eingeben und laden.</p></div>
    </div>

    <div class="panel" data-panel="section">
      <div class="panel-head">
        <div>
          <h2>Abschnitt</h2>
          <p>Aktivitäten eines Abschnitts (<code>getCourseSections</code>).</p>
        </div>
        <div class="toolbar">
          <input class="id-input" id="section-id" type="text" inputmode="numeric" placeholder="Abschnitts-ID" />
          <button class="btn primary" id="load-section">Laden</button>
        </div>
      </div>
      <div class="output" id="out-section"><p class="empty">Abschnitts-ID eingeben und laden.</p></div>
    </div>

    <div class="panel" data-panel="module">
      <div class="panel-head">
        <div>
          <h2>Aufgabe</h2>
          <p>Beschreibung, Materialien und Abgabestatus (<code>getCourseModule</code>).</p>
        </div>
        <div class="toolbar">
          <input class="id-input" id="module-id" type="text" inputmode="numeric" placeholder="Modul-ID" />
          <button class="btn primary" id="load-module">Laden</button>
        </div>
      </div>
      <div class="output" id="out-module"><p class="empty">Modul-ID eingeben und laden.</p></div>
    </div>

    <div class="panel" data-panel="folder">
      <div class="panel-head">
        <div>
          <h2>Ordner</h2>
          <p>Dateien eines Ordners (<code>getCourseSectionFolder</code>).</p>
        </div>
        <div class="toolbar">
          <input class="id-input" id="folder-id" type="text" inputmode="numeric" placeholder="Ordner-ID" />
          <button class="btn primary" id="load-folder">Laden</button>
        </div>
      </div>
      <div class="output" id="out-folder"><p class="empty">Ordner-ID eingeben und laden.</p></div>
    </div>

    <div class="panel" data-panel="notifications">
      <div class="panel-head">
        <div>
          <h2>Mitteilungen</h2>
          <p>Benachrichtigungen des angemeldeten Kontos (<code>getNotifications</code>).</p>
        </div>
        <div class="toolbar">
          <button class="btn primary" id="load-notifications">Mitteilungen laden</button>
        </div>
      </div>
      <div class="output" id="out-notifications"><p class="empty">Noch keine Daten geladen.</p></div>
    </div>
  </section>
</main>

<script>
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function api(path, options) {
    options = options || {};
    var init = { method: options.method || "GET", headers: {} };
    if (options.body !== undefined) {
      init.method = options.method || "POST";
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : "HTTP " + res.status);
        return data;
      });
    });
  }

  function setMsg(node, text, kind) {
    node.hidden = false;
    node.textContent = text;
    node.className = "msg " + (kind || "info");
  }

  function formatDate(ts) {
    if (!ts) return "–";
    return new Date(ts * 1000).toLocaleDateString("de-DE");
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("de-DE");
  }

  function rawBlock(data) {
    return '<details class="raw"><summary>Rohdaten (JSON)</summary><pre>' +
      esc(JSON.stringify(data, null, 2)) + '</pre></details>';
  }

  function quickAction(url) {
    if (!url) return "";
    var m = url.match(/mod\\/(assign|folder)\\/view\\.php\\?id=(\\d+)/);
    if (!m) return "";
    var kind = m[1] === "assign" ? "module" : "folder";
    return ' <button type="button" class="link-btn" data-goto="' + kind + '" data-id="' + m[2] + '">in eigener Ansicht öffnen</button>';
  }

  // --- rendering -----------------------------------------------------------

  function renderCourses(data) {
    var out = $("#out-courses");
    var courses = data.courses || [];
    if (!courses.length) {
      out.innerHTML = '<p class="empty">Keine Kurse gefunden.</p>' + rawBlock(data.raw);
      return;
    }
    var rows = courses.map(function (c) {
      var visible = c.visible
        ? '<span class="tag tag-ok">sichtbar</span>'
        : '<span class="tag">verborgen</span>';
      return '<tr class="clickable" data-id="' + esc(c.id) + '">' +
        '<td class="mono">' + esc(c.id) + '</td>' +
        '<td>' + esc(c.fullname) + '</td>' +
        '<td class="mono">' + esc(c.shortname) + '</td>' +
        '<td>' + visible + '</td>' +
        '<td class="mono">' + esc(formatDate(c.enddate)) + '</td>' +
        '</tr>';
    }).join("");
    out.innerHTML =
      '<p class="result-meta">' + courses.length + ' Kurse <span class="dim">· Zeile anklicken für die Kursstruktur</span></p>' +
      '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Kurs</th><th>Kurzname</th><th>Status</th><th>Ende</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' + rawBlock(data.raw);
    $$("#out-courses tr.clickable").forEach(function (tr) {
      tr.addEventListener("click", function () {
        $("#course-id").value = tr.getAttribute("data-id");
        switchTab("course");
        loadCourse();
      });
    });
  }

  function renderCourse(data) {
    var out = $("#out-course");
    var sections = data.sections || [];
    var html = '<div class="result-head"><h3>' + esc(data.titel || "Kurs") + '</h3>' +
      '<span class="tag">' + sections.length + ' Abschnitte</span></div>';
    if (!sections.length) {
      html += '<p class="empty">Keine Abschnitte gefunden.</p>';
    }
    sections.forEach(function (s, i) {
      var acts = (s.activities || []).map(function (a) {
        var link = a.url
          ? '<a href="' + esc(a.url) + '" target="_blank" rel="noreferrer">' + esc(a.name) + '</a>'
          : esc(a.name);
        return '<li>' + link + '<span class="dim mono">#' + esc(a.id) + '</span>' + quickAction(a.url) + '</li>';
      }).join("");
      html += '<details class="section"' + (i === 0 ? " open" : "") + '>' +
        '<summary><span>' + esc(s.name || ("Abschnitt " + (i + 1))) + '</span>' +
        '<span class="tag">' + esc(s.sectionCount) + ' Aktivitäten</span></summary>' +
        (acts ? '<ul class="activity-list">' + acts + '</ul>' : '<p class="empty" style="padding:10px 12px">Keine Aktivitäten.</p>') +
        '</details>';
    });
    out.innerHTML = html + rawBlock(data);
  }

  function renderSection(data) {
    var out = $("#out-section");
    var items = Array.isArray(data) ? data : [];
    if (!items.length) {
      out.innerHTML = '<p class="empty">Keine Aktivitäten gefunden.</p>' + rawBlock(data);
      return;
    }
    out.innerHTML = '<p class="result-meta">' + items.length + ' Einträge</p><ul class="activity-list">' +
      items.map(function (a) {
        var link = a.url
          ? '<a href="' + esc(a.url) + '" target="_blank" rel="noreferrer">' + esc(a.title) + '</a>'
          : esc(a.title);
        return '<li><span class="tag">' + esc(a.type || "?") + '</span>' + link +
          '<span class="dim mono">#' + esc(a.id) + '</span>' + quickAction(a.url) + '</li>';
      }).join("") + '</ul>' + rawBlock(data);
  }

  function fileList(title, files) {
    if (!files || !files.length) {
      return '<h4 class="sub">' + esc(title) + '</h4><p class="empty">Keine Einträge.</p>';
    }
    return '<h4 class="sub">' + esc(title) + '</h4><ul class="file-list">' +
      files.map(function (f) {
        return '<li><a href="' + esc(f.url) + '" target="_blank" rel="noreferrer">' + esc(f.name) + '</a>' +
          (f.date ? '<span class="dim">' + esc(f.date) + '</span>' : "") + '</li>';
      }).join("") + '</ul>';
  }

  function renderModule(data) {
    var out = $("#out-module");
    var html = '<div class="result-head"><h3>' + esc(data.title || "Aufgabe") + '</h3></div>';
    var keys = data.status ? Object.keys(data.status) : [];
    if (keys.length) {
      html += '<dl class="kv list">' + keys.map(function (k) {
        return '<div><dt>' + esc(k) + '</dt><dd>' + esc(data.status[k]) + '</dd></div>';
      }).join("") + '</dl>';
    }
    if (data.tasks) {
      html += '<h4 class="sub">Beschreibung</h4><pre class="text-block">' + esc(data.tasks) + '</pre>';
    }
    html += fileList("Materialien", data.materials);
    html += fileList("Abgaben", data.submissions);
    out.innerHTML = html + rawBlock(data);
  }

  function renderFolder(data) {
    var out = $("#out-folder");
    var items = Array.isArray(data) ? data : [];
    if (!items.length) {
      out.innerHTML = '<p class="empty">Keine Dateien gefunden.</p>' + rawBlock(data);
      return;
    }
    out.innerHTML = '<p class="result-meta">' + items.length + ' Dateien</p><ul class="file-list">' +
      items.map(function (f) {
        return '<li><span class="tag">' + esc(f.type || "Datei") + '</span>' +
          '<a href="' + esc(f.url) + '" target="_blank" rel="noreferrer">' + esc(f.name) + '</a></li>';
      }).join("") + '</ul>' + rawBlock(data);
  }

  function extractNotifications(data) {
    if (Array.isArray(data)) {
      var first = data[0] || {};
      if (first.data && Array.isArray(first.data.notifications)) return first.data.notifications;
      return data;
    }
    if (data && Array.isArray(data.notifications)) return data.notifications;
    return [];
  }

  function renderNotifications(data) {
    var out = $("#out-notifications");
    var items = extractNotifications(data);
    if (!items.length) {
      out.innerHTML = '<p class="empty">Keine Mitteilungen.</p>' + rawBlock(data);
      return;
    }
    out.innerHTML = '<p class="result-meta">' + items.length + ' Mitteilungen</p><ul class="notice-list">' +
      items.map(function (n) {
        var meta = [formatDateTime(n.timecreated), n.component].filter(Boolean).join(" · ");
        return '<li><div class="notice-subject">' + esc(n.subject || n.smallmessage || "Mitteilung") + '</div>' +
          '<div class="notice-body">' + esc(n.fullmessage || n.smallmessage || "") + '</div>' +
          (meta ? '<div class="dim mono">' + esc(meta) + '</div>' : "") + '</li>';
      }).join("") + '</ul>' + rawBlock(data);
  }

  // --- actions -------------------------------------------------------------

  function run(buttonSel, outputSel, request, render) {
    var button = $(buttonSel);
    var out = $(outputSel);
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Lädt …";
    out.setAttribute("aria-busy", "true");
    request()
      .then(render)
      .catch(function (err) {
        out.innerHTML = '<p class="empty error">' + esc(err.message) + '</p>';
      })
      .finally(function () {
        button.disabled = false;
        button.textContent = label;
        out.removeAttribute("aria-busy");
      });
  }

  function loadCourse() {
    var id = $("#course-id").value.trim();
    if (!id) return;
    run("#load-course", "#out-course", function () {
      return api("/api/course/" + encodeURIComponent(id));
    }, renderCourse);
  }

  function loadSection() {
    var id = $("#section-id").value.trim();
    if (!id) return;
    run("#load-section", "#out-section", function () {
      return api("/api/section/" + encodeURIComponent(id));
    }, renderSection);
  }

  function loadModule() {
    var id = $("#module-id").value.trim();
    if (!id) return;
    run("#load-module", "#out-module", function () {
      return api("/api/module/" + encodeURIComponent(id));
    }, renderModule);
  }

  function loadFolder() {
    var id = $("#folder-id").value.trim();
    if (!id) return;
    run("#load-folder", "#out-folder", function () {
      return api("/api/folder/" + encodeURIComponent(id));
    }, renderFolder);
  }

  $("#load-courses").addEventListener("click", function () {
    run("#load-courses", "#out-courses", function () {
      return api("/api/courses", { method: "POST" });
    }, renderCourses);
  });
  $("#load-course").addEventListener("click", loadCourse);
  $("#load-section").addEventListener("click", loadSection);
  $("#load-module").addEventListener("click", loadModule);
  $("#load-folder").addEventListener("click", loadFolder);
  $("#load-notifications").addEventListener("click", function () {
    run("#load-notifications", "#out-notifications", function () {
      return api("/api/notifications");
    }, renderNotifications);
  });

  $("#out-course").addEventListener("click", function (e) {
    var target = e.target.closest("[data-goto]");
    if (!target) return;
    var id = target.getAttribute("data-id");
    if (target.getAttribute("data-goto") === "module") {
      $("#module-id").value = id;
      switchTab("module");
      loadModule();
    } else {
      $("#folder-id").value = id;
      switchTab("folder");
      loadFolder();
    }
  });

  // Enter in the ID fields triggers the matching load.
  [["#course-id", loadCourse], ["#section-id", loadSection], ["#module-id", loadModule], ["#folder-id", loadFolder]].forEach(function (pair) {
    $(pair[0]).addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); pair[1](); }
    });
  });

  // --- connection ----------------------------------------------------------

  function refreshStatus() {
    return api("/api/status").then(function (s) {
      var pill = $("#server-pill");
      if (!s.configured) {
        pill.textContent = "Nicht konfiguriert";
        pill.className = "pill pill-idle";
      } else if (!s.loggedIn) {
        pill.textContent = "Bereit · nicht angemeldet";
        pill.className = "pill pill-warn";
      } else {
        pill.textContent = "Angemeldet";
        pill.className = "pill pill-ok";
      }
      if (s.configured) $("#server-url").value = s.serverUrl || "";
      $("#session-info").hidden = !s.loggedIn;
      if (s.loggedIn) {
        $("#info-server").textContent = s.serverUrl;
        $("#info-user").textContent = s.username;
      }
    });
  }

  $("#connect-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("#connect-msg");
    var btn = $("#login-btn");
    var serverUrl = $("#server-url").value.trim();
    var username = $("#username").value.trim();
    var password = $("#password").value;

    setMsg(msg, "Verbinde …", "info");
    btn.disabled = true;
    api("/api/configure", {
      method: "POST",
      body: { serverUrl: serverUrl, allowUnsafe: $("#allow-unsafe").checked, debug: $("#debug").checked }
    })
      .then(function () {
        return api("/api/login", { method: "POST", body: { username: username, password: password } });
      })
      .then(function () {
        setMsg(msg, "Erfolgreich angemeldet.", "ok");
        $("#password").value = "";
        return refreshStatus();
      })
      .catch(function (err) {
        setMsg(msg, err.message, "error");
      })
      .finally(function () {
        btn.disabled = false;
      });
  });

  $("#logout-btn").addEventListener("click", function () {
    api("/api/logout", { method: "POST" }).then(function () {
      $("#connect-msg").hidden = true;
      refreshStatus();
    });
  });

  // --- tabs ----------------------------------------------------------------

  function switchTab(name) {
    $$(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === name);
    });
    $$(".panel").forEach(function (p) {
      p.classList.toggle("active", p.getAttribute("data-panel") === name);
    });
  }

  $$(".tab").forEach(function (t) {
    t.addEventListener("click", function () { switchTab(t.getAttribute("data-tab")); });
  });

  refreshStatus();
})();
</script>
</body>
</html>`;

app.get("/", (req, res) => {
    res.type("html").send(page);
});

app.listen(PORT, () => {
    console.log("Logineo LMS client demo: http://localhost:" + PORT);
});
