import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { LuLock, LuEye, LuEyeOff } from "react-icons/lu";
import { html, API } from "../lib.js";

export function PasskeyScreen({ onSuccess }) {
  const [passkey, setPasskey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = async () => {
    if (loading) return;
    if (!passkey) {
      setError("Enter your passkey");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(API + "/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Invalid passkey");
        setPasskey("");
        inputRef.current?.focus();
      } else {
        sessionStorage.setItem("_dev_passkey", passkey);
        onSuccess();
      }
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return html`<${motion.div}
    className="passkey-screen"
    initial=${{ opacity: 0 }}
    animate=${{ opacity: 1 }}
    exit=${{ opacity: 0 }}
    transition=${{ duration: 0.3 }}
  >
    <div className="splash-glow" />
    <${motion.div}
      className="passkey-card"
      initial=${{ opacity: 0, scale: 0.95, y: 20 }}
      animate=${{ opacity: 1, scale: 1, y: 0 }}
      transition=${{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <${LuLock} size=${28} color="#0072ff" />
      <h2>Dashboard Passkey</h2>
      <p>Enter your passkey to continue</p>
      <div className="passkey-field" style=${{ position: "relative", width: "100%" }}>
        <input
          ref=${inputRef}
          type=${show ? "text" : "password"}
          autoComplete="current-password"
          className=${error ? "error" : ""}
          value=${passkey}
          placeholder="Passkey"
          style=${{ width: "100%", paddingRight: "40px" }}
          onInput=${(e) => {
            setPasskey(e.target.value);
            setError("");
          }}
          onKeyDown=${handleKeyDown}
        />
        <span
          onClick=${() => setShow((s) => !s)}
          title=${show ? "Hide" : "Show"}
          style=${{
            position: "absolute",
            right: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            cursor: "pointer",
            color: "var(--text-muted, #888)",
            display: "flex",
          }}
        >
          ${show ? html`<${LuEyeOff} size=${18} />` : html`<${LuEye} size=${18} />`}
        </span>
      </div>
      <div className="passkey-error">${error}</div>
      <button className="passkey-btn" onClick=${handleSubmit} disabled=${loading}>
        ${loading ? "Verifying..." : "Unlock Dashboard"}
      </button>
    <//>
  <//>`;
}
