import React, { useState, useEffect, useCallback } from "react";
import { LuMail, LuCheck, LuSend } from "react-icons/lu";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

// Copy-paste usage shown in the right-hand code panel.
const USAGE_TABS = [
  {
    id: "basic",
    label: "Basic",
    code: `import { sendMail, emailTemplate } from '../services/mailer.js';

// Call from any route handler. Credentials come from .env.
await sendMail({
  to: 'user@example.com',
  subject: 'Welcome to 4Brains!',
  html: emailTemplate({ title: 'Welcome', body: 'Thanks for signing up.' }),
  // text: 'Plain-text fallback',     // optional
  // cc, bcc, replyTo, from           // optional
});`,
  },
  {
    id: "attachment",
    label: "Attachment",
    code: `import { sendMail } from '../services/mailer.js';

await sendMail({
  to: 'user@example.com',
  subject: 'Your invoice',
  text: 'Invoice attached.',
  attachments: [
    // a) from a file on disk
    { filename: 'invoice.pdf', path: './invoices/inv-001.pdf' },
    // b) generated content (string or Buffer)
    { filename: 'note.txt', content: 'Generated at ' + new Date().toISOString() },
    // c) an uploaded file (multer)  ->  req.file
    { filename: req.file.originalname, path: req.file.path },
  ],
});`,
  },
  {
    id: "ejs",
    label: "Dynamic (EJS)",
    code: `// Any template engine works: render it to an HTML string, pass as \`html\`.
import { sendMail } from '../services/mailer.js';
import ejs from 'ejs';           // npm i ejs
import path from 'path';

// views/emails/welcome.ejs:
//   <h1>Hi <%= name %></h1>
//   <p>Verify: <a href="<%= link %>"><%= link %></a></p>

const html = await ejs.renderFile(
  path.join(process.cwd(), 'views/emails/welcome.ejs'),
  { name: user.name, link: 'https://app.com/verify/' + token }   // dynamic data
);

await sendMail({ to: user.email, subject: 'Welcome', html });

// Handlebars / Pug / React Email: same idea — produce an HTML
// string from your data, then hand it to sendMail({ html }).`,
  },
];

export function MailPage() {
  const { toast, refresh } = useApp();
  const [info, setInfo] = useState(null);
  const [provider, setProvider] = useState("resend");
  const [form, setForm] = useState({
    apiKey: "", resendFrom: "",
    host: "", port: 587, secure: false, user: "", pass: "", smtpFrom: "",
  });
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState("");
  const [domainPassword, setDomainPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("basic");

  const activeTab = USAGE_TABS.find((t) => t.id === tab) || USAGE_TABS[0];

  function copyUsage() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(activeTab.code);
    } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const load = useCallback(async () => {
    try {
      const r = await api("/mail");
      setInfo(r);
      // Persisted failure from the last save survives reloads until it's fixed.
      setConfigError(r.configured && r.verified === false
        ? "The saved email configuration failed its last connection test. Update the details and save again."
        : "");
      setProvider(r.provider || "resend");
      const rs = r.resend || {}, sm = r.smtp || {};
      setForm((f) => ({
        ...f,
        resendFrom: rs.from || f.resendFrom,
        host: sm.host || f.host,
        port: sm.port || f.port || 587,
        secure: !!sm.secure,
        user: sm.user || f.user,
        smtpFrom: sm.from || f.smtpFrom,
      }));
    } catch (err) { toast(err.message, "error"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  function setField(patch) { setForm((f) => ({ ...f, ...patch })); }

  function pickProvider(p) { setProvider(p.id); }
  // TLS drives the SMTP port: on → 465 (implicit TLS), off → 587 (STARTTLS).
  function setTls(on) { setForm((f) => ({ ...f, secure: on, port: on ? 465 : 587 })); }

  async function save() {
    let body;
    if (provider === "resend") {
      if (!form.resendFrom.trim()) { toast("From address is required", "error"); return; }
      if (!form.apiKey.trim() && !(info.resend && info.resend.hasKey)) { toast("API key is required", "error"); return; }
      body = { provider: "resend", apiKey: form.apiKey.trim(), from: form.resendFrom.trim(), domainPassword };
    } else {
      if (!form.host.trim()) { toast("SMTP host is required", "error"); return; }
      body = { provider: "smtp", host: form.host.trim(), port: form.port, secure: form.secure, user: form.user.trim(), pass: form.pass, from: form.smtpFrom.trim(), domainPassword };
    }
    setBusy(true);
    try {
      const r = await api("/mail/setup", { method: "POST", body });
      await load(); // refresh info (and the persisted verify status)
      if (r && r.verified === false) {
        setConfigError(r.error || "Configuration failed. Check the details and try again.");
        toast(r.message || "Configuration test failed", "error");
      } else {
        setConfigError("");
        toast(r.message, "success");
      }
      refresh().catch(() => {});
    } catch (err) {
      setConfigError(err.message || "Configuration failed.");
      toast(err.message, "error");
    }
    setBusy(false);
  }

  async function sendTest() {
    if (!testTo.trim()) { toast("Enter a recipient", "error"); return; }
    setTesting(true);
    try {
      const r = await api("/mail/test", { method: "POST", body: { to: testTo.trim() } });
      toast(r.message, "success");
    } catch (err) { toast(err.message, "error"); }
    setTesting(false);
  }

  if (!info) return html`<div className="text-muted" style=${{ padding: "16px" }}>Loading…</div>`;

  const current = (info.providers || []).find((p) => p.id === provider) || {};
  const providers = info.providers || [];

  // 4brains.in is an official domain — it can't be used directly; an authorization
  // password is required and its use is reported to the domain owner. The effective
  // SMTP sender is the From, or the User when From is blank — check both, matching
  // the server (from || user).
  const officialRe = /4brains\.in/i;
  const officialValues = provider === "resend" ? [form.resendFrom] : [form.host, form.user, form.smtpFrom];
  const isOfficial = officialValues.some((v) => officialRe.test(String(v || "")));

  const labelStyle = { fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: "8px" };

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">Email</div>
        <div className="card-subtitle">Transactional email via IntraApp(Postmaster) or any custom SMTP server</div>
      </div>
      ${info.configured && html`<span className="badge badge-success">Configured</span>`}
    </div>

    <div style=${{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <!-- LEFT: provider + SMTP config -->
      <div className="card" style=${{ flex: "1 1 420px", minWidth: 0 }}>
        <div style=${labelStyle}>Provider</div>
        <div style=${{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: current.hint ? "6px" : "14px" }}>
          ${providers.map((p) => html`<button key=${p.id} className="badge"
            onClick=${() => pickProvider(p)}
            style=${{ cursor: "pointer", border: "1px solid var(--border)", background: provider === p.id ? "var(--accent-glow)" : "var(--bg-input)", color: provider === p.id ? "var(--accent-light)" : "var(--text-secondary)" }}>${p.label}</button>`)}
        </div>
        ${current.hint && html`<div className="text-sm text-muted" style=${{ marginBottom: "14px" }}>${current.hint}</div>`}

        ${provider === "resend"
          ? html`<div className="form-group">
              <label className="form-label">From address</label>
              <input className="form-input" value=${form.resendFrom} onInput=${(e) => setField({ resendFrom: e.target.value })} placeholder="no-reply@yourdomain.com" />
            </div>
            <div className="form-group">
              <label className="form-label">API Key ${info.resend && info.resend.hasKey ? html`<span className="text-muted" style=${{ fontWeight: 400 }}>(saved)</span>` : ""}</label>
              <input className="form-input" type="password" value=${form.apiKey} onInput=${(e) => setField({ apiKey: e.target.value })} placeholder=${info.resend && info.resend.hasKey ? "••••••••" : "re_..."} />
            </div>`
          : html`<div style=${{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <div className="form-group" style=${{ flex: "1 1 200px" }}>
                <label className="form-label">SMTP Host</label>
                <input className="form-input" value=${form.host} onInput=${(e) => setField({ host: e.target.value })} placeholder="smtp.example.com" />
              </div>
              <div className="form-group" style=${{ flex: "0 0 90px" }}>
                <label className="form-label">Port</label>
                <input className="form-input" type="number" value=${form.port} onInput=${(e) => setField({ port: e.target.value })} />
              </div>
              <div className="form-group" style=${{ flex: "0 0 110px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <label style=${{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer", paddingBottom: "10px" }}>
                  <input type="checkbox" checked=${form.secure} onChange=${(e) => setTls(e.target.checked)} /> TLS
                </label>
              </div>
            </div>
            <div style=${{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <div className="form-group" style=${{ flex: "1 1 180px" }}>
                <label className="form-label">User</label>
                <input className="form-input" value=${form.user} onInput=${(e) => setField({ user: e.target.value })} placeholder="SMTP username" />
              </div>
              <div className="form-group" style=${{ flex: "1 1 180px" }}>
                <label className="form-label">Password ${info.smtp && info.smtp.hasPass ? html`<span className="text-muted" style=${{ fontWeight: 400 }}>(saved)</span>` : ""}</label>
                <input className="form-input" type="password" value=${form.pass} onInput=${(e) => setField({ pass: e.target.value })} placeholder=${info.smtp && info.smtp.hasPass ? "••••••••" : "secret"} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">From address</label>
              <input className="form-input" value=${form.smtpFrom} onInput=${(e) => setField({ smtpFrom: e.target.value })} placeholder="no-reply@yourdomain.com" />
            </div>`}
        ${isOfficial && html`<div className="form-group" style=${{ border: "1px solid #f59e0b", borderRadius: "8px", padding: "12px", background: "rgba(245,158,11,0.08)" }}>
          <div className="text-sm" style=${{ color: "#f59e0b", marginBottom: "8px", fontWeight: 600 }}>
            4brains.in is an official email domain — you can't use it directly.
          </div>
          <div className="text-sm text-muted" style=${{ marginBottom: "8px" }}>
            Enter the authorization password to continue. Its use will be reported to the domain owner.
          </div>
          <label className="form-label">Authorization password</label>
          <input className="form-input" type="password" value=${domainPassword} onInput=${(e) => setDomainPassword(e.target.value)} placeholder="Required for 4brains.in" />
        </div>`}
        <button className="btn btn-primary" onClick=${save} disabled=${busy || (provider === "smtp" && !form.host.trim()) || (provider === "resend" && !form.resendFrom.trim()) || (isOfficial && !domainPassword)}>
          ${busy ? html`<span className="spinner" />` : html`<${LuCheck} size=${16} />`}
          ${busy ? "Saving..." : "Save & install"}
        </button>

        ${info.configured && html`<div style=${{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
          <div style=${labelStyle}>Send test email</div>
          <div style=${{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style=${{ flex: "1 1 200px", marginBottom: 0 }}>
              <input className="form-input" value=${testTo} onInput=${(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            </div>
            <button className="btn btn-primary" onClick=${sendTest} disabled=${testing || !testTo.trim()}>
              ${testing ? html`<span className="spinner" />` : html`<${LuSend} size=${16} />`}
              ${testing ? "Sending..." : "Send test"}
            </button>
          </div>
        </div>`}
      </div>

      <!-- RIGHT: code card + (optional) error card, stacked -->
      <div style=${{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div style=${{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            ${USAGE_TABS.map((t) => html`<button key=${t.id}
              onClick=${() => setTab(t.id)}
              style=${{ cursor: "pointer", fontSize: "12px", padding: "5px 11px", borderRadius: "7px", border: "1px solid var(--border)", background: tab === t.id ? "var(--accent-glow)" : "var(--bg-input)", color: tab === t.id ? "var(--accent-light)" : "var(--text-secondary)" }}>${t.label}</button>`)}
          </div>
          <button className="btn btn-sm" style=${{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-secondary)" }} onClick=${copyUsage}>
            ${copied ? html`<${LuCheck} size=${14} />` : null} ${copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre style=${{ background: "#0a0c12", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px", fontSize: "12px", lineHeight: 1.55, color: "#d5d8e3", overflow: "auto", margin: 0, fontFamily: "ui-monospace,Menlo,monospace", whiteSpace: "pre" }}>${activeTab.code}</pre>
      </div>

      ${configError && html`<div className="card" style=${{ border: "1px solid #ef4444", background: "rgba(239,68,68,0.08)" }}>
        <div style=${{ color: "#ef4444", fontWeight: 600, marginBottom: "6px" }}>⚠ Configuration failed</div>
        <div className="text-sm" style=${{ color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>${configError}</div>
      </div>`}
      </div>
    </div>
  </div>`;
}
