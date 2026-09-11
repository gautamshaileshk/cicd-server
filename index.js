import register from './src/routes/register.js';
import connectDB from './src/db.js';
import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import cors from "cors";
import os from "os";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createInterface } from "readline";
import { notFound, errorHandler } from "./src/middleware/errorHandler.js";
import { startAdvertising, destroyDiscovery } from "./src/discovery.js";

// ── Environment ─────────────────────────────────────
dotenv.config();

connectDB();
const app = express();
// Behind reverse proxies (e.g. nginx → load balancer). Lets Express read the real
// client IP from X-Forwarded-For so rate limiting and req.ip are correct. The number
// is how many proxy hops to trust — adjust to your infrastructure.
app.set("trust proxy", 2);
const port = process.env.PORT || 3000;
const __dirname = path.resolve();

// ── Middleware ───────────────────────────────────────
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── Dev Dashboard (local development only) ───────────
// The dashboard at /_dev can write files and run shell commands — it is a
// remote-code-execution surface and must NEVER be reachable in production.
// In production it is not even imported. It additionally restricts itself to
// loopback requests, validates Host/Origin (defeats DNS-rebinding), and requires
// a passkey for remote access (see .4bnode/dev-api.js). It is mounted BEFORE the
// permissive global CORS below so `Access-Control-Allow-Origin: *` never applies
// to the dashboard.
//   • production (NODE_ENV=production): OFF — set _4BNODE_DASHBOARD=on to force.
//   • non-production: ON — set _4BNODE_DASHBOARD=off to disable.
const dashboardEnabled =
  process.env._4BNODE_DASHBOARD === "on" ||
  (process.env.NODE_ENV !== "production" && process.env._4BNODE_DASHBOARD !== "off");
if (dashboardEnabled) {
  try {
    const devApi = await import("./.4bnode/dev-api.js");
    app.use("/_dev", devApi.default);
  } catch {}
}

// ── CORS (applies to your API, not the /_dev dashboard above) ──
app.use(cors({ origin: "*" }));

// ── Security (built-in by default) ───────────────────
// Mounted AFTER the /_dev dashboard so its CDN/inline scripts aren't blocked by
// helmet's CSP and the dashboard isn't throttled by the rate limiter.
// helmet() defaults to a strict Content-Security-Policy (script-src 'self',
// etc.) that blocks CDN-loaded scripts, inline <script> blocks, and cross-origin
// assets. We widen the policy so a typical frontend/docs page works while keeping
// the rest of helmet's protections. Tighten these directives for production.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https:', "'unsafe-inline'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Allow other origins (e.g. a separate frontend host) to load assets served
  // by this app. Default is 'same-origin'. Tighten to 'same-site' for production.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Rate limiting ────────────────────────────────────
// Tune via .env: RATE_LIMIT_WINDOW_MS (ms) and RATE_LIMIT_MAX (per window).
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(apiLimiter);

// ── Static Files ────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── Helpers ─────────────────────────────────────────
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function updateEnvPort(newPort) {
  try {
    if (fs.existsSync(".env")) {
      let content = fs.readFileSync(".env", "utf8");
      if (content.match(/^PORT=.*/m)) {
        content = content.replace(/^PORT=.*/m, `PORT=${newPort}`);
      } else {
        content += `\nPORT=${newPort}`;
      }
      fs.writeFileSync(".env", content, "utf8");
    }
  } catch {}
}

function askPort(busyPort) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\nPort ${busyPort} is already in use.`);
    rl.question(`Press Enter to use ${busyPort + 1}, or type a port number: `, (answer) => {
      rl.close();
      const custom = parseInt(answer.trim(), 10);
      resolve(custom && custom > 0 ? custom : busyPort + 1);
    });
  });
}

app.use('/api/register', register);

// ── Error handling (must be last) ──
app.use(notFound);
app.use(errorHandler);

// ── Start Server ────────────────────────────────────
async function startServer(tryPort) {
  const listener = app.listen(tryPort);
  listener.on("listening", () => {
    const localIp = getLocalNetworkIp();
    console.log(`App is running on http://localhost:${tryPort}`);
    if (localIp) {
      console.log(`App is also accessible on your local network at http://${localIp}:${tryPort}`);
    }
    if (tryPort !== Number(port)) {
      updateEnvPort(tryPort);
      console.log(`Updated .env with PORT=${tryPort}`);
    }
    // Advertise on the local network via Bonjour/mDNS — only now that the server
    // is actually listening on `tryPort`. Re-runs cleanly if the port changed.
    startAdvertising({ port: tryPort }).catch(() => {});
  });
  listener.on("error", async (err) => {
    if (err.code === "EADDRINUSE") {
      if (!process.stdin.isTTY) {
        // Running under pm2 / systemd / IntraApp — no terminal to prompt.
        console.error(`Port ${tryPort} is in use and no TTY is available. Exiting.`);
        process.exit(1);
      }
      const nextPort = await askPort(tryPort);
      startServer(nextPort);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
// On a clean exit, unpublish the Bonjour service so TTL=0 "goodbye" packets are
// sent and clients drop the stale record immediately. Only an uncatchable
// SIGKILL now bypasses this.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down...`);
  try {
    await destroyDiscovery();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// nodemon restarts the app by sending SIGUSR2. Unpublish first (so clients get
// the goodbye packet and no stale record lingers across dev restarts), then
// re-raise the signal so nodemon performs the actual restart. once() prevents a
// loop by removing our handler before we re-raise.
process.once("SIGUSR2", async () => {
  try {
    await destroyDiscovery();
  } catch {}
  process.kill(process.pid, "SIGUSR2");
});

startServer(Number(port));
