import React from "react";
import { html, Icons } from "../lib.js";
import { useApp } from "../context.js";

export function Sidebar() {
  const { page, setPage, data } = useApp();
  const dbOk = data.mongoConfigured;

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: Icons.dashboard,
      section: "Overview",
    },
    // AI Builder — temporarily hidden from the menu (re-enable by uncommenting)
    // { id: "ai-builder", label: "AI Builder", icon: Icons.ai },
    {
      id: "database",
      label: "Database",
      icon: Icons.database,
      section: "Setup",
    },
    {
      id: "schemas",
      label: "Schemas",
      icon: Icons.schema,
      locked: !dbOk,
      lockMsg: "Requires database",
    },
    { id: "routes", label: "API Routes", icon: Icons.route },
    { id: "docs", label: "API Docs", icon: Icons.docs },
    { id: "api-tester", label: "API Tester", icon: Icons.apiTester },
    {
      id: "security",
      label: "Security",
      icon: Icons.shield,
      section: "Features",
    },
    { id: "realtime", label: "Real-time", icon: Icons.realtime },
    { id: "serialport", label: "SerialPort", icon: Icons.serial },
    { id: "mail", label: "Email", icon: Icons.mail },
    { id: "discovery", label: "Discovery", icon: Icons.network },
    { id: "logs", label: "Logs", icon: Icons.logs, section: "Settings" },
    { id: "env", label: "Environment", icon: Icons.env },
  ];

  let currentSection = null;
  return html`<div className="sidebar">
    <div className="sidebar-brand">
      <pre>${`██╗  ██╗██████╗ ███╗   ██╗ ██████╗ ██████╗ ███████╗\n██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██╔════╝\n███████║██████╔╝██╔██╗ ██║██║   ██║██║  ██║█████╗\n╚════██║██╔══██╗██║╚██╗██║██║   ██║██║  ██║██╔══╝\n     ██║██████╔╝██║ ╚████║╚██████╔╝██████╔╝███████╗\n     ╚═╝╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝`}</pre>
    </div>
    ${navItems.map((item) => {
      const sectionHeader =
        item.section && item.section !== currentSection
          ? ((currentSection = item.section),
            html`<div className="sidebar-section">${item.section}</div>`)
          : null;
      return html`<${React.Fragment} key=${item.id}>
        ${sectionHeader}
        <div
          className=${`sidebar-item ${page === item.id ? "active" : ""} ${item.locked ? "locked" : ""}`}
          onClick=${() => !item.locked && setPage(item.id)}
          title=${item.locked ? item.lockMsg : item.label}
        >
          <span className="sidebar-icon">${item.icon}</span>
          ${item.label}
          ${item.locked &&
          html`<span className="lock-icon">${Icons.lock}</span>`}
        </div>
      <//>`;
    })}
  </div>`;
}
