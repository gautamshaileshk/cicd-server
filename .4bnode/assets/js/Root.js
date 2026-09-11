import React, { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { html, API, getStoredPasskey } from "./lib.js";
import { App } from "./App.js";
import { PasskeyScreen } from "./screens/PasskeyScreen.js";

export function Root() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = getStoredPasskey();
        const res = await fetch(API + '/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passkey: stored }),
        });
        if (res.ok) setAuthed(true);
      } catch {}
      setChecking(false);
    })();
  }, []);

  if (checking) return null;

  return html`<${AnimatePresence} mode="wait">
    ${!authed
      ? html`<${PasskeyScreen} key="passkey" onSuccess=${() => setAuthed(true)} />`
      : html`<${motion.div} key="app"
          style=${{ display: 'flex', height: '100vh', width: '100%' }}
          initial=${{ opacity: 0 }}
          animate=${{ opacity: 1 }}
          transition=${{ duration: 0.4 }}>
          <${App} />
        <//>`}
  <//>`;
}
