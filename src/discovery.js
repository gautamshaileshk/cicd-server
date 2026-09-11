// Bonjour / mDNS service discovery
// Zero-config LAN networking: this app advertises itself so other devices can
// find it by name (host.local) without hard-coded IPs, and can browse for other
// services on the same network.
//
// This module is written to be defensive and robust. The lessons baked in here
// are exactly the ones that make mDNS silently fail in the wild:
//
//   - bonjour-service is imported LAZILY. A project that has not installed it (or
//     runs somewhere the native mDNS socket cannot bind) still boots fine;
//     advertising just becomes a no-op in an "unsupported" state.
//   - The SRV host is ALWAYS explicitly .local-suffixed. os.hostname() alone can
//     return a bare name (e.g. "MSI" on Windows), which routes address lookups to
//     unicast DNS instead of multicast DNS and never resolves.
//   - Only STABLE metadata goes in the TXT record (platform, app name). Putting
//     per-restart / per-interface data like an IP in TXT produces conflicting
//     duplicate records; some clients (notably iOS NWBrowser) then silently never
//     resolve the service, with no error and no timeout.
//   - A single service instance is kept at a time; re-advertising (e.g. after a
//     port change) stops the old one first so the network never sees duplicates.
//   - Clean shutdown sends TTL=0 "goodbye" packets so stale records do not linger
//     in client caches for the record's full TTL (can be over an hour).
//
// Configure via .env:  BONJOUR_ENABLED=off | BONJOUR_NAME=... | BONJOUR_TYPE=http

import os from "os";

let bonjour = null; // shared mDNS controller (created lazily, one per process)
let published = null; // handle to the currently-advertised service, if any
let BonjourCtor = null; // cached constructor after the first successful import

let selfState = {
  status: "idle", // idle | advertising | error | unsupported
  name: null,
  type: null,
  port: null,
  host: null,
  txt: null,
  error: null,
};

// Import bonjour-service on demand. Returns the constructor, or null if the
// package is not installed / cannot load. Handles both the named (Bonjour) and
// default export shapes across versions.
async function loadBonjour() {
  if (BonjourCtor) return BonjourCtor;
  try {
    const mod = await import("bonjour-service");
    BonjourCtor =
      mod.Bonjour ||
      mod.default ||
      (mod.default && mod.default.Bonjour) ||
      null;
    return BonjourCtor;
  } catch {
    return null;
  }
}

// Always .local-suffixed, single-label host so address lookups use mDNS.
function localHostname() {
  const base = (os.hostname() || "device").split(".")[0].trim() || "device";
  return base + ".local";
}

// Build a network-unique default service name. Two apps scaffolded from the same
// skeleton on different machines would otherwise collide on the same name.
function defaultServiceName() {
  // An explicit BONJOUR_NAME is used verbatim — the user owns uniqueness.
  if (process.env.BONJOUR_NAME) return process.env.BONJOUR_NAME;
  // Auto name: project name + hostname, so two machines don't collide.
  const base = process.env.APP_NAME || process.env.npm_package_name || "4bnode-app";
  const host = (os.hostname() || "").split(".")[0].replace(/[^a-zA-Z0-9-]/g, "");
  return host ? base + " (" + host + ")" : base;
}

// On by default; opt out with BONJOUR_ENABLED=off.
export function isDiscoveryEnabled() {
  return process.env.BONJOUR_ENABLED !== "off";
}

// Snapshot of what this process is currently advertising (read by the dashboard).
export function getSelfState() {
  return { ...selfState, enabled: isDiscoveryEnabled() };
}

// Advertise this app on the local network. Safe to call repeatedly; each call
// replaces any prior advertisement, so a port change re-publishes cleanly. Must
// be called AFTER the HTTP server is actually listening (so the port is bound).
export async function startAdvertising({ port, name, type } = {}) {
  if (!isDiscoveryEnabled()) {
    selfState = { ...selfState, status: "idle", error: null };
    return getSelfState();
  }
  if (!port) return getSelfState();

  const Ctor = await loadBonjour();
  if (!Ctor) {
    selfState = {
      status: "unsupported",
      name: null,
      type: null,
      port: null,
      host: null,
      txt: null,
      error: "bonjour-service not installed",
    };
    console.log(
      "mDNS: bonjour-service not installed - LAN discovery disabled. Run: npm install bonjour-service to enable.",
    );
    return getSelfState();
  }

  // Replace any previous advertisement so two conflicting records never coexist.
  await stopAdvertising();
  if (!bonjour) bonjour = new Ctor();

  const serviceName = name || defaultServiceName();
  const serviceType = type || process.env.BONJOUR_TYPE || "http";
  const host = localHostname();
  const txt = {
    platform: os.platform(), // stable across restarts - safe for TXT
    app: process.env.APP_NAME || process.env.npm_package_name || "4bnode-app",
  };

  try {
    published = bonjour.publish({ name: serviceName, type: serviceType, port, host, txt });
    selfState = {
      status: "advertising",
      name: serviceName,
      type: serviceType,
      port,
      host,
      txt,
      error: null,
    };
    published.on("up", () => {
      console.log(
        "mDNS: advertising " + JSON.stringify(serviceName) + " at " + host + ":" + port + " (_" + serviceType + "._tcp.local)",
      );
    });
    published.on("error", (err) => {
      const msg = String((err && err.message) || err);
      selfState = { ...selfState, status: "error", error: msg };
      console.warn(
        "mDNS: advertising error - " + msg + ". If discovery is not working, check that UDP port 5353 is not blocked by a firewall.",
      );
    });
  } catch (err) {
    selfState = { ...selfState, status: "error", error: String((err && err.message) || err) };
  }
  return getSelfState();
}

// Stop advertising and send the TTL=0 goodbye packets. Resolves once the mDNS
// responder has flushed them (or after a short safety timeout, so a stuck
// responder can never hang process shutdown).
export function stopAdvertising() {
  return new Promise((resolve) => {
    if (!bonjour) {
      published = null;
      return resolve();
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      published = null;
      if (selfState.status === "advertising") selfState = { ...selfState, status: "idle" };
      resolve();
    };
    try {
      bonjour.unpublishAll(finish); // constructs + sends goodbye packets
      const t = setTimeout(finish, 1500);
      if (t.unref) t.unref();
    } catch {
      finish();
    }
  });
}

// Full teardown for process shutdown: goodbye packets, then destroy the socket.
export async function destroyDiscovery() {
  await stopAdvertising();
  try {
    if (bonjour) bonjour.destroy();
  } catch {}
  bonjour = null;
}

// Browse the LAN for services of a given type. Collects results for timeoutMs
// (de-duplicated, excluding our own advertisement), then stops the browser and
// resolves. "available" is false when bonjour-service is not installed.
export async function browse({ type = "http", timeoutMs = 2500 } = {}) {
  const Ctor = await loadBonjour();
  if (!Ctor) return { available: false, services: [] };
  if (!bonjour) bonjour = new Ctor();

  return new Promise((resolve) => {
    const found = new Map();
    let browser = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        if (browser && typeof browser.stop === "function") browser.stop();
      } catch {}
      resolve({ available: true, services: Array.from(found.values()) });
    };

    try {
      browser = bonjour.find({ type }, (service) => {
        // Exclude our own advertisement from the peer list.
        if (published && selfState.name && service.name === selfState.name) return;
        const key = service.name + "|" + service.host + "|" + service.port;
        found.set(key, {
          name: service.name,
          host: service.host,
          port: service.port,
          type: service.type,
          protocol: service.protocol,
          addresses: Array.isArray(service.addresses) ? service.addresses : [],
          txt: service.txt || {},
          fqdn: service.fqdn || null,
        });
      });
    } catch (err) {
      settled = true;
      return resolve({ available: true, services: [], error: String((err && err.message) || err) });
    }

    const t = setTimeout(finish, Math.max(500, Math.min(10000, Number(timeoutMs) || 2500)));
    if (t.unref) t.unref();
  });
}
