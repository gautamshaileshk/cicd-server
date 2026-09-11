import React, { useState, useEffect } from "react";
import { html, api } from "../lib.js";
import { useApp } from "../context.js";

export function DatabasePage() {
  const { data, status, toast, refresh } = useApp();
  // MongoDB is the only database, so the page shows its configuration directly
  // (no database picker).
  // Default the database name to the app's folder name (provided by the server).
  const appName = status?.appName || "myapp";
  const [inputMode, setInputMode] = useState("fields"); // 'fields' or 'url'
  const [uri, setUri] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("27017");
  const [dbName, setDbName] = useState("");
  const [dbNameTouched, setDbNameTouched] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  // Prefill the db name with the folder name once status loads — unless the user
  // edited it, or we're editing an already-configured connection.
  useEffect(() => {
    if (!dbNameTouched && !data.mongoConfigured && status?.appName) {
      setDbName(status.appName);
    }
  }, [status?.appName, data.mongoConfigured, dbNameTouched]);

  // Parse existing URI when entering edit mode
  useEffect(() => {
    if (data.mongoConfigured && data.mongoUri) {
      setUri(data.mongoUri);
      parseUriToFields(data.mongoUri);
    }
  }, [data.mongoUri]);

  function parseUriToFields(uriStr) {
    try {
      const match = uriStr.match(
        /^mongodb(?:\+srv)?:\/\/(?:([^:]+):([^@]+)@)?([^:\/]+)(?::(\d+))?\/(.+?)(?:\?.*)?$/,
      );
      if (match) {
        setUsername(match[1] || "");
        setPassword(match[2] || "");
        setHost(match[3] || "localhost");
        setPort(match[4] || "27017");
        setDbName(match[5] || appName);
      }
    } catch {}
  }

  function buildUri(h, p, db, user, pass) {
    const auth =
      user && pass
        ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
        : "";
    return `mongodb://${auth}${h || "localhost"}:${p || "27017"}/${db || appName}`;
  }

  function getUri() {
    return inputMode === "url"
      ? (uri || "").trim() || `mongodb://localhost:27017/${appName}`
      : buildUri(host, port, dbName, username, password);
  }

  async function handleSetup() {
    const connUri = getUri();
    if (!connUri.startsWith("mongodb://") && !connUri.startsWith("mongodb+srv://")) {
      toast("Invalid MongoDB URI. Must start with mongodb:// or mongodb+srv://", "error");
      return;
    }
    setLoading(true);
    try {
      const isFirstTime = !data.mongoConfigured;
      const result = await api("/add-mongo", {
        method: "POST",
        body: { uri: connUri },
      });
      toast(result.message, "success");
      setEditing(false);
      if (isFirstTime) {
        // Server restarts after first-time setup — wait then retry refresh
        setTimeout(async () => {
          for (let i = 0; i < 10; i++) {
            try {
              await refresh();
              setLoading(false);
              return;
            } catch {}
            await new Promise((r) => setTimeout(r, 1500));
          }
          setLoading(false);
        }, 2000);
      } else {
        refresh().catch(() => {});
        setLoading(false);
      }
    } catch (err) {
      toast(err.message, "error");
      setLoading(false);
    }
  }

  // Mask password in URI for display
  function maskUri(u) {
    if (!u) return "";
    return u.replace(/:([^@\/]+)@/, ":****@");
  }

  const showForm = !data.mongoConfigured || editing;

  const inputModeToggle = html`<div className="flex gap-2 mb-4">
    <button
      className=${`btn btn-sm ${inputMode === "fields" ? "btn-primary" : "btn-ghost"}`}
      onClick=${() => setInputMode("fields")}
    >
      Configuration
    </button>
    <button
      className=${`btn btn-sm ${inputMode === "url" ? "btn-primary" : "btn-ghost"}`}
      onClick=${() => setInputMode("url")}
    >
      Connection URI
    </button>
  </div>`;

  const urlInputs = html`<fragment>
    <div className="form-group">
      <label className="form-label">Connection URI</label>
      <input
        className="form-input"
        value=${uri}
        onInput=${(e) => setUri(e.target.value)}
        placeholder="mongodb://username:password@localhost:27017/myapp"
      />
    </div>
  </fragment>`;

  const fieldInputs = html`<fragment>
    <div className="grid-2 mb-2">
      <div className="form-group">
        <label className="form-label">Host</label>
        <input
          className="form-input"
          value=${host}
          onInput=${(e) => setHost(e.target.value)}
          placeholder="localhost"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Port</label>
        <input
          className="form-input"
          value=${port}
          onInput=${(e) => setPort(e.target.value)}
          placeholder="27017"
        />
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">Database Name</label>
      <input
        className="form-input"
        value=${dbName}
        onInput=${(e) => { setDbNameTouched(true); setDbName(e.target.value); }}
        placeholder=${appName}
      />
    </div>
    <div className="grid-2 mb-4">
      <div className="form-group">
        <label className="form-label">Username (optional)</label>
        <input
          className="form-input"
          value=${username}
          onInput=${(e) => setUsername(e.target.value)}
          placeholder="admin"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Password (optional)</label>
        <input
          className="form-input"
          type="password"
          value=${password}
          onInput=${(e) => setPassword(e.target.value)}
          placeholder="********"
        />
      </div>
    </div>
  </fragment>`;

  // Preview the generated URI when in fields mode
  const previewUri =
    inputMode === "fields"
      ? html`<div className="form-group" style=${{ marginTop: "8px" }}>
          <label
            className="form-label text-muted"
            style=${{ fontSize: "11px" }}
            >Generated URI</label
          >
          <div
            className="text-sm text-muted"
            style=${{
              fontFamily: "monospace",
              padding: "8px 12px",
              background: "rgba(255,255,255,0.03)",
              borderRadius: "6px",
              wordBreak: "break-all",
            }}
          >
            ${maskUri(getUri())}
          </div>
        </div>`
      : null;

  return html`<div>
    <div className="card-title mb-1">Database</div>
    <div className="card-subtitle mb-4">
      Configure the MongoDB connection for your project
    </div>

    ${data.mongoConfigured &&
    !editing &&
    html`<div
      className="card mb-6"
      style=${{ borderColor: "rgba(34,197,94,0.3)" }}
    >
      <div className="flex items-center gap-3">
        <img
          src="/_dev/assets/images/mongo.png"
          alt="MongoDB"
          style=${{ width: "28px", height: "28px", objectFit: "contain" }}
        />
        <div style=${{ flex: 1, minWidth: 0 }}>
          <div style=${{ fontWeight: 600, fontSize: "14px" }}>
            MongoDB Connected
          </div>
          <div
            className="text-sm text-muted"
            style=${{ fontFamily: "monospace", wordBreak: "break-all" }}
          >
            ${maskUri(data.mongoUri || "")}
          </div>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick=${() => {
            if (data.mongoUri) {
              setUri(data.mongoUri);
              parseUriToFields(data.mongoUri);
            }
            setEditing(true);
          }}
          style=${{ marginLeft: "auto" }}
        >
          Edit
        </button>
        <span className="badge badge-success">✓ Active</span>
      </div>
    </div>`}

    ${showForm &&
    html`<div className="card">
      <div className="flex items-center gap-3 mb-4">
        <img
          src="/_dev/assets/images/mongo.png"
          alt="MongoDB"
          style=${{ width: "24px", height: "24px", objectFit: "contain" }}
        />
        <div className="card-title" style=${{ margin: 0 }}>
          ${editing ? "Edit Connection" : "MongoDB Setup"}
        </div>
        <div style=${{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          ${editing &&
          html`<button
            className="btn btn-sm btn-ghost"
            onClick=${() => setEditing(false)}
          >
            Cancel
          </button>`}
          <button
            className="btn btn-sm btn-primary"
            onClick=${handleSetup}
            disabled=${loading}
          >
            ${loading ? html`<span className="spinner" />` : null}
            ${loading
              ? "Configuring..."
              : editing
                ? "Save Changes"
                : "Connect Database"}
          </button>
        </div>
      </div>
      ${inputModeToggle} ${inputMode === "url" ? urlInputs : fieldInputs}
      ${previewUri}
    </div>`}
  </div>`;
}
