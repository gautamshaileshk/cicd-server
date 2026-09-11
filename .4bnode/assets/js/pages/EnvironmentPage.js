import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

export function EnvironmentPage() {
  const { toast } = useApp();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api("/env")
      .then((res) => {
        setContent(res.content || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleChange(e) {
    setContent(e.target.value);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await api("/env", {
        method: "PUT",
        body: { content },
      });
      toast(result.message, "success");
      setDirty(false);
    } catch (err) {
      toast(err.message, "error");
    }
    setSaving(false);
  }

  function countVars(c) {
    if (!c) return 0;
    return c.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('=')).length;
  }

  return html`<div>
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="card-title">Environment</div>
        <div className="card-subtitle">Manage environment variables</div>
      </div>
    </div>

    <div className="card mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style=${{ fontWeight: 600, fontSize: '16px', marginBottom: '2px' }}>.env</div>
          <div className="text-sm text-muted">${() => countVars(content)} variable${() => countVars(content) !== 1 ? 's' : ''} defined</div>
        </div>
        <div className="flex gap-2 items-center">
          ${() => dirty && html`<span className="text-sm text-muted" style=${{ fontSize: '11px' }}>Unsaved</span>`}
          <button className="btn btn-sm btn-primary" onClick=${handleSave} disabled=${saving || !dirty}>
            ${saving ? html`<span className="spinner" />` : null}
            ${saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>

    <div className="card" style=${{ padding: 0, overflow: 'hidden' }}>
      <div style=${{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style=${{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Editor</span>
        <span className="field-count" style=${{ fontSize: '11px' }}>Cmd+S to save</span>
      </div>
      <${motion.div} initial=${{ opacity: 0, y: 6 }} animate=${{ opacity: 1, y: 0 }} transition=${{ duration: 0.12 }}>
        ${loading
          ? html`<div className="text-sm text-muted" style=${{ padding: '40px 0', textAlign: 'center' }}>Loading...</div>`
          : html`<textarea
              className="env-editor"
              value=${content}
              onInput=${handleChange}
              placeholder=${"# Add environment variables\n# KEY=value"}
              spellCheck=${false}
              style=${{ borderRadius: 0, border: 'none' }}
              onKeyDown=${(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const start = e.target.selectionStart;
                  const end = e.target.selectionEnd;
                  setContent(e.target.value.substring(0, start) + "  " + e.target.value.substring(end));
                  setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = start + 2; }, 0);
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                  e.preventDefault();
                  if (dirty) handleSave();
                }
              }}
            />`}
      <//>
    </div>
  </div>`;
}
