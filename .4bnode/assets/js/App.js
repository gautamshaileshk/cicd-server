import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { html, api, PAGE_TITLES } from "./lib.js";
import { AppContext } from "./context.js";
import { Sidebar } from "./components/Sidebar.js";
import { ToastContainer } from "./components/ToastContainer.js";
import { ConfirmDialog } from "./components/Modal.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DatabasePage } from "./pages/DatabasePage.js";
import { SchemasPage } from "./pages/SchemasPage.js";
import { RoutesPage } from "./pages/RoutesPage.js";
import { DocsPage } from "./pages/DocsPage.js";
import { AiBuilderPage } from "./pages/AiBuilderPage.js";
import { SecurityPage } from "./pages/SecurityPage.js";
import { ApiTesterPage } from "./pages/ApiTesterPage.js";
import { RealtimePage } from "./pages/RealtimePage.js";
import { SerialPortPage } from "./pages/SerialPortPage.js";
import { MailPage } from "./pages/MailPage.js";
import { DiscoveryPage } from "./pages/DiscoveryPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { EnvironmentPage } from "./pages/EnvironmentPage.js";

function getHashPage() {
  const hash = window.location.hash.replace("#/", "").replace("#", "");
  return hash && PAGE_TITLES[hash] ? hash : "dashboard";
}

export function App() {
  const [page, setPageState] = useState(getHashPage);
  const [data, setData] = useState({
    models: [],
    routes: [],
    mongoConfigured: false,
    routesDirExists: false,
  });
  const [status, setStatus] = useState({});
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const showConfirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setConfirmState({ message, ...opts, resolve });
    });
  }, []);

  const setPage = useCallback((p) => {
    window.location.hash = "#/" + p;
  }, []);

  useEffect(() => {
    function onHash() {
      setPageState(getHashPage());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const toast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      3500,
    );
  }, []);

  const refresh = useCallback(async () => {
    // File-writing actions (create route, docs, security, ...) modify index.js,
    // which triggers a nodemon restart. Since the dashboard is served by that same
    // app, the refresh fetch fired right after can hit the restart window and fail,
    // leaving the UI stale until a manual reload. Retry across the restart so new
    // state shows up in real time.
    let lastErr;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const [dashData, statusData] = await Promise.all([
          api("/dashboard"),
          api("/status"),
        ]);
        setData(dashData);
        setStatus(statusData);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastErr;
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const pages = {
    dashboard: html`<${DashboardPage} />`,
    "ai-builder": html`<${AiBuilderPage} />`,
    database: html`<${DatabasePage} />`,
    schemas: html`<${SchemasPage} />`,
    routes: html`<${RoutesPage} />`,
    docs: html`<${DocsPage} />`,
    security: html`<${SecurityPage} />`,
    "api-tester": html`<${ApiTesterPage} />`,
    realtime: html`<${RealtimePage} />`,
    serialport: html`<${SerialPortPage} />`,
    mail: html`<${MailPage} />`,
    discovery: html`<${DiscoveryPage} />`,
    logs: html`<${LogsPage} />`,
    env: html`<${EnvironmentPage} />`,
  };

  return html`<${AppContext.Provider}
    value=${{ page, setPage, data, status, toasts, toast, refresh, showConfirm }}
  >
    <${Sidebar} />
    <div className="main">
      <div className="topbar">
        <h2>${PAGE_TITLES[page] || "Dashboard"}</h2>
      </div>
      <div className="content">
        <${AnimatePresence} mode="wait">
          <${motion.div} key=${page}
            initial=${{ opacity: 0, y: 8 }}
            animate=${{ opacity: 1, y: 0 }}
            exit=${{ opacity: 0, y: -8 }}
            transition=${{ duration: 0.15 }}>
            ${pages[page] || pages.dashboard}
          <//>
        <//>
      </div>
    </div>
    <${ToastContainer} />
    ${confirmState && html`<${ConfirmDialog}
      message=${confirmState.message}
      confirmLabel=${confirmState.confirmLabel}
      danger=${confirmState.danger}
      onConfirm=${() => { confirmState.resolve(true); setConfirmState(null); }}
      onCancel=${() => { confirmState.resolve(false); setConfirmState(null); }}
    />`}
  <//>`;
}
