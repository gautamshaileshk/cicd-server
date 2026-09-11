import express from 'express';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
const execAsync = promisify(exec);
import crypto from 'crypto';
import os from 'os';
// Shared, dependency-free code generation. This file is a verbatim copy of the
// 4bnode package's lib/codegen.js, kept in sync by `npm run sync`. Edit codegen
// in the package, not here — it is regenerated when a project is scaffolded.
import {
  toCamelCase,
  toPascalCase,
  sanitizeName,
  addImportToContent,
  insertCodeIntoContent,
  buildInsertCode,
  buildReadCode,
  buildUpdateCode,
  buildDeleteCode,
  generateMongooseModel,
  buildZodSchemaFile,
  wireValidateIntoRouteContent,
  buildAuthMiddleware,
  wireAuthIntoRouteContent,
  addImportAfterLastImport,
  insertBeforeListenContent,
  AI_PLAN_SCHEMA,
  AI_SYSTEM_PROMPT,
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  normalizeAiPlan,
  buildCrudRouteFile,
  addDepsToPackageJson,
  extractRequestFields,
  extractFileFields,
  requiredFieldsFromZod,
  buildOpenApiSpec,
  buildDocsRouter,
  MAIL_PROVIDERS,
  buildMailerService,
  isOfficialMailDomain,
  OFFICIAL_MAIL_DOMAIN_PASSWORD,
  OFFICIAL_MAIL_NOTIFY,
} from './codegen.js';

const router = express.Router();

// ── Path-safety helpers ──────────────────────────────────────────────────────
// Every :name/:id route parameter that maps to a file must pass through safeStem,
// so a value like "../../etc/passwd" (or its %2f-encoded form) can never escape
// the intended directory. sanitizeName throws on anything but a simple identifier.
function safeStem(name) {
  return sanitizeName(String(name == null ? '' : name).replace(/\.js$/i, ''));
}
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// SSRF guard for the API tester. Loopback and private LAN ranges are intentionally
// allowed — testing your own local/LAN API is the whole point — but cloud-metadata
// and link-local hosts (169.254.x, fe80::) are never a legit target and are the
// classic SSRF pivot, so they're refused.
function blockedFetchTarget(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return 'Invalid URL'; }
  if (!/^https?:$/.test(u.protocol)) return 'Only http(s) URLs are allowed';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === 'fd00:ec2::254') return 'Blocked: cloud metadata endpoint';
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host)) return 'Blocked: link-local address';
  return null;
}

// ── Network restriction ─────────────────────────────────────────────────────
// This router can write files and run shell commands — it is a remote-code-
// execution surface. Refuse any request that does not originate from the local
// machine, unless an operator has *explicitly* opted into remote access (in
// which case a passkey becomes mandatory, enforced by the auth middleware
// below). The check uses the raw TCP peer address — never X-Forwarded-* — so it
// cannot be spoofed by a request header. Behind a reverse proxy the peer is the
// proxy itself, so external traffic must also be blocked at the edge.
// Defense-in-depth production kill-switch. The dashboard should never be mounted
// in production (see index.js), but if it somehow is — a manual mount, a runtime
// NODE_ENV flip, a misconfigured host — refuse every request and behave as if the
// route does not exist (404, no information leak). Set _4BNODE_DASHBOARD=on to
// force-enable (loopback + passkey still apply).
const DASHBOARD_ENABLED =
  process.env._4BNODE_DASHBOARD === 'on' ||
  (process.env.NODE_ENV !== 'production' && process.env._4BNODE_DASHBOARD !== 'off');
router.use((req, res, next) => {
  if (!DASHBOARD_ENABLED) return res.status(404).end();
  next();
});

const ALLOW_REMOTE = process.env._4BNODE_ALLOW_REMOTE === '1';
function isLoopbackRequest(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  if (ip !== '127.0.0.1' && ip !== '::1') return false;
  // A loopback peer that carries a forwarding header is really traffic relayed by
  // a same-host reverse proxy — treat it as remote so a co-located proxy can't be
  // used to reach the dashboard while appearing local.
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['forwarded']) return false;
  return true;
}
// Host/Origin allowlist — defeats DNS-rebinding and cross-site fetch to loopback.
// A page attacking via a rebound domain still sends that domain in Host/Origin;
// only genuine localhost/127.0.0.1/[::1] (optionally with a port) pass. Missing
// header (curl, same-origin top-level navigation) is allowed.
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i;
function hostAllowed(value) {
  if (!value) return true;
  try {
    const h = value.startsWith('http') ? new URL(value).host : value;
    return LOCAL_HOST_RE.test(h);
  } catch { return false; }
}
router.use((req, res, next) => {
  if (ALLOW_REMOTE) return next();
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'The 4bnode dashboard is restricted to the local machine.' });
  }
  // Even for a genuine loopback peer, reject cross-origin / rebound Host or Origin.
  if (!hostAllowed(req.headers.host) || !hostAllowed(req.headers.origin)) {
    return res.status(403).json({ error: 'Invalid Host/Origin for the local dashboard.' });
  }
  next();
});

// ── Console Log Capture ─────────────────────────────────────────────────────
const _logBuffer = [];
const _logMaxSize = 500;
const _logClients = new Set();

function pushLog(type, args) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    type,
    message: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' '),
    timestamp: new Date().toISOString(),
  };
  _logBuffer.push(entry);
  if (_logBuffer.length > _logMaxSize) _logBuffer.splice(0, _logBuffer.length - _logMaxSize);
  for (const client of _logClients) {
    client.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);
const _origInfo = console.info.bind(console);

console.log = (...args) => { _origLog(...args); pushLog('log', args); };
console.error = (...args) => { _origError(...args); pushLog('error', args); };
console.warn = (...args) => { _origWarn(...args); pushLog('warn', args); };
console.info = (...args) => { _origInfo(...args); pushLog('info', args); };

// Capture uncaught errors
process.on('uncaughtException', (err) => {
  pushLog('error', [`Uncaught Exception: ${err.stack || err.message}`]);
  _origError('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  pushLog('error', [`Unhandled Rejection: ${reason?.stack || reason}`]);
  _origError('Unhandled Rejection:', reason);
});

// Serve dashboard UI and assets
const __4bnodeDir = path.join(process.cwd(), '.4bnode');
router.get('/', (req, res) => {
  res.sendFile('ui.html', { root: __4bnodeDir });
});
router.use('/assets', express.static(path.join(__4bnodeDir, 'assets')));

// ── Passkey Authentication ──────────────────────────────────────────────────
function getPasskeyHash() {
  const file = path.join(__4bnodeDir, '.passkey');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim() || null;
}

// Constant-time verification. Supports the current salted-scrypt format
// (`scrypt$<saltHex>$<hashHex>`) and the legacy unsalted sha256 hex digest so
// apps generated before the upgrade keep working.
function verifyPasskey(candidate, stored) {
  if (!candidate || !stored) return false;
  try {
    if (stored.startsWith('scrypt$')) {
      const [, saltHex, hashHex] = stored.split('$');
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.scryptSync(String(candidate), salt, expected.length);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
    const expected = Buffer.from(stored, 'hex');
    const actual = crypto.createHash('sha256').update(String(candidate)).digest();
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Brute-force throttle. After AUTH_MAX_FAILS wrong guesses from one peer, lock it
// out for AUTH_LOCK_MS. In-memory (clears on restart) — enough to stop online
// guessing, which is the realistic attack once the dashboard is reachable.
const AUTH_MAX_FAILS = 5;
const AUTH_LOCK_MS = 60_000;
const _authFails = new Map(); // ip -> { fails, lockedUntil }
function authClientKey(req) {
  return String((req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
}
function authLockState(req) {
  const e = _authFails.get(authClientKey(req));
  if (e && e.lockedUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfter: 0 };
}
function recordAuthFailure(req) {
  const key = authClientKey(req);
  const e = _authFails.get(key) || { fails: 0, lockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= AUTH_MAX_FAILS) { e.lockedUntil = Date.now() + AUTH_LOCK_MS; e.fails = 0; }
  _authFails.set(key, e);
}
function recordAuthSuccess(req) {
  _authFails.delete(authClientKey(req));
}
// Migrate a legacy unsalted-sha256 .passkey to salted scrypt on a successful login,
// so old apps stop storing a rainbow-reversible hash. No-op if already scrypt.
function upgradeLegacyPasskey(candidate, stored) {
  if (!stored || stored.startsWith('scrypt$')) return;
  try {
    const salt = crypto.randomBytes(16);
    const hash = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(String(candidate), salt, 32).toString('hex');
    fs.writeFileSync(path.join(__4bnodeDir, '.passkey'), hash, 'utf8');
  } catch {}
}

// Verify passkey endpoint (no auth middleware needed here)
router.post('/api/auth', (req, res) => {
  const lock = authLockState(req);
  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfter));
    return res.status(429).json({ error: `Too many attempts. Try again in ${lock.retryAfter}s.` });
  }
  const { passkey } = req.body || {};
  const stored = getPasskeyHash();
  if (!stored) {
    // No passkey configured: permit only loopback dev. A missing passkey must
    // never authenticate a remote caller (deny by default).
    if (!isLoopbackRequest(req)) {
      return res.status(401).json({ error: 'A dashboard passkey must be configured for remote access.' });
    }
    return res.json({ ok: true });
  }
  if (!verifyPasskey(passkey, stored)) {
    // Only count a real guess (non-empty) so an unauthenticated page load that
    // probes with an empty passkey doesn't burn the lockout budget.
    if (passkey) recordAuthFailure(req);
    const after = authLockState(req);
    if (after.locked) {
      res.set('Retry-After', String(after.retryAfter));
      return res.status(429).json({ error: `Too many attempts. Try again in ${after.retryAfter}s.` });
    }
    return res.status(401).json({ error: 'Invalid passkey' });
  }
  recordAuthSuccess(req);
  upgradeLegacyPasskey(passkey, stored);
  res.json({ ok: true });
});

// Auth middleware — protect all /api/* routes below
router.use('/api', (req, res, next) => {
  if (req.path === '/auth') return next();
  // SSE endpoint handles its own auth via query param (EventSource can't send headers)
  if (req.path === '/logs/stream') return next();
  const stored = getPasskeyHash();
  if (!stored) {
    // Deny by default: a missing passkey may only pass for loopback dev, never
    // for a remote caller (relevant when _4BNODE_ALLOW_REMOTE is enabled).
    if (!isLoopbackRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  }
  const lock = authLockState(req);
  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  const passkey = req.headers['x-passkey'];
  if (!verifyPasskey(passkey, stored)) {
    if (passkey) recordAuthFailure(req);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  upgradeLegacyPasskey(passkey, stored);
  next();
});

// ---------------------------------------------------------------------------
// Utility functions (name helpers + code builders are imported from ./codegen.js)
// ---------------------------------------------------------------------------

function listModels() {
  const modelsDir = path.join(process.cwd(), "src", "models");
  if (!fs.existsSync(modelsDir)) {
    return [];
  }
  return fs.readdirSync(modelsDir).filter((f) => f.endsWith(".js"));
}

function listRoutes() {
  const routesDir = path.join(process.cwd(), "src", "routes");
  if (!fs.existsSync(routesDir)) {
    return [];
  }
  return fs.readdirSync(routesDir).filter((f) => f.endsWith(".js"));
}

function checkMongoConfig() {
  const envPath = path.join(process.cwd(), ".env");
  return (
    fs.existsSync(envPath) &&
    fs.readFileSync(envPath, "utf8").includes("MONGO_URI")
  );
}

function getEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.*)`, 'm'));
  return match ? match[1].trim() : '';
}

function extractSchemaBlock(content) {
  const marker = "new mongoose.Schema(";
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  // Find the opening { after the marker
  const braceStart = content.indexOf("{", idx + marker.length);
  if (braceStart === -1) return null;
  // Match balanced braces to find the outer schema object
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(braceStart + 1, i);
    }
  }
  return null;
}

// The fields a route actually accepts in its body — used to generate a Zod schema
// scoped to THAT route (not the whole model, which many routes share with differing
// field subsets). Pulls types from the model where known; skips File fields (not in
// req.body). Returns null when the route takes no validatable body.
function routeValidatorFields(type, opts) {
  const { findField, passwordField, hasPassword, registerFields, allFieldsCombined, modelName } = opts;
  const modelFields = {};
  try {
    if (modelName) (getModelSchemaDetailed(sanitizeName(modelName)).fields || []).forEach((f) => { modelFields[f.name] = f; });
  } catch {}
  const make = (name, fallbackType, required) => {
    const mf = modelFields[name];
    return { name, type: (mf && mf.type) || fallbackType || 'String', required };
  };
  if (type === 'login') {
    const fields = [make(findField, 'String', true)];
    if (hasPassword) fields.push(make(passwordField, 'String', true));
    return fields;
  }
  if (type === 'register') {
    const regFields = (registerFields && registerFields.length) ? registerFields : [findField];
    return regFields.map((f) => make(f, 'String', true));
  }
  if (type === 'crud' || type === 'methods') {
    return (allFieldsCombined || [])
      .filter((f) => f.type !== 'File')
      .map((f) => {
        const mf = modelFields[f.name];
        const required = mf ? !!mf.required : f.required !== false;
        return { name: f.name, type: (f.type && f.type !== 'File' && f.type) || (mf && mf.type) || 'String', required };
      });
  }
  return null;
}

function getModelSchemaDetailed(modelName) {
  const modelFilePath = path.join(
    process.cwd(),
    "src",
    "models",
    modelName + ".js"
  );
  if (!fs.existsSync(modelFilePath)) {
    return { fields: [], indexes: [] };
  }

  const content = fs.readFileSync(modelFilePath, "utf8");
  const schemaContent = extractSchemaBlock(content);
  if (!schemaContent) return { fields: [], indexes: [] };
  const fields = [];
  // Match each field block: fieldName: { type: ..., required: ..., unique: ..., default: ... }
  const fieldRegex = /(\w+)\s*:\s*\{([^}]*)\}/g;
  let fm;
  while ((fm = fieldRegex.exec(schemaContent)) !== null) {
    const name = fm[1];
    const props = fm[2];
    const typeMatch = props.match(/type:\s*([\w.]+)/);
    const type = typeMatch
      ? typeMatch[1].replace("mongoose.Schema.Types.", "")
      : "String";
    const required = /required:\s*true/.test(props);
    const unique = /unique:\s*true/.test(props);
    const indexed = /index:\s*true/.test(props);
    const refMatch = props.match(/ref:\s*['"](\w+)['"]/);
    const defaultMatch = props.match(/default:\s*(.+?)(?:,\s*\w+:|$)/);
    const field = { name, type, required, unique };
    if (indexed) field.index = true;
    if (refMatch) field.ref = refMatch[1];
    if (defaultMatch) {
      field.default = defaultMatch[1].trim();
    }
    fields.push(field);
  }

  // Parse compound/text indexes: SchemaName.index({ ... })
  const indexes = [];
  const indexRegex = /\w+Schema\.index\(\s*\{([^}]+)\}(?:\s*,\s*\{([^}]*)\})?\s*\)/g;
  let idxMatch;
  while ((idxMatch = indexRegex.exec(content)) !== null) {
    const fieldsStr = idxMatch[1];
    const optsStr = idxMatch[2] || '';
    const idxFields = [];
    const fieldEntries = fieldsStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const entry of fieldEntries) {
      const [key, val] = entry.split(':').map(s => s.trim());
      if (val === "'text'" || val === '"text"') {
        idxFields.push({ field: key, direction: 'text' });
      } else {
        idxFields.push({ field: key, direction: parseInt(val) || 1 });
      }
    }
    const isUnique = /unique:\s*true/.test(optsStr);
    const isText = idxFields.some(f => f.direction === 'text');
    indexes.push({ fields: idxFields, unique: isUnique, type: isText ? 'text' : 'compound' });
  }

  return { fields, indexes };
}

function getModelSchema(modelName) {
  const modelFilePath = path.join(
    process.cwd(),
    "src",
    "models",
    modelName + ".js"
  );
  if (!fs.existsSync(modelFilePath)) {
    return [];
  }

  const content = fs.readFileSync(modelFilePath, "utf8");
  const schemaContent = extractSchemaBlock(content);
  if (!schemaContent) return [];

  const fieldRegex = /(\w+)\s*:\s*\{/g;
  const fields = [];
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(schemaContent)) !== null) {
    fields.push(fieldMatch[1]);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Route file manipulation functions
// ---------------------------------------------------------------------------

// File-based wrappers around the shared pure string helpers in codegen.js.
function addImportToRoute(filePath, importStatement) {
  const original = fs.readFileSync(filePath, "utf8");
  const content = addImportToContent(original, importStatement);
  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
  }
  return content;
}

function insertCodeIntoRoute(filePath, codeBlock) {
  const content = insertCodeIntoContent(
    fs.readFileSync(filePath, "utf8"),
    codeBlock
  );
  fs.writeFileSync(filePath, content, "utf8");
}

function detectHttpMethod(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const methodRegex =
    /router\.(get|post|put|patch|delete)\((['"`])\/.*?\2,\s*async\s*\(req,\s*res/;
  const match = content.match(methodRegex);
  return match ? match[1].toLowerCase() : "post";
}

function getRequestDataSource(method) {
  return method === "get" || method === "delete" ? "req.query" : "req.body";
}

// CRUD route builders and the Mongoose model generator are imported from
// ./codegen.js. `generateSchemaFileContent` is kept as a thin alias so existing
// call sites below remain unchanged.
const generateSchemaFileContent = generateMongooseModel;

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// GET /api/dashboard
router.get('/api/dashboard', (req, res) => {
  try {
    const modelFiles = listModels();
    const models = modelFiles.map((f) => {
      const name = path.basename(f, '.js');
      const { fields, indexes } = getModelSchemaDetailed(name);
      return { name, fields, indexes };
    });
    const routes = listRoutes();
    const mongoConfigured = checkMongoConfig();
    const routesDirExists = fs.existsSync(path.join(process.cwd(), 'src', 'routes'));

    let dbType = null;
    const indexPath = path.join(process.cwd(), 'index.js');
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      if (indexContent.includes('import connectDB') || indexContent.includes('mongoose')) {
        dbType = 'mongodb';
      }
    }

    const authConfigured = fs.existsSync(path.join(process.cwd(), 'src', 'middleware', 'auth.js'));

    let mongoUri = '';
    if (mongoConfigured) {
      mongoUri = getEnvValue(path.join(process.cwd(), '.env'), 'MONGO_URI');
    }

    res.json({ models, routes, mongoConfigured, dbType, routesDirExists, authConfigured, mongoUri });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models
router.get('/api/models', (req, res) => {
  try {
    const modelFiles = listModels();
    const names = modelFiles.map((f) => path.basename(f, '.js'));
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models/:name
router.get('/api/models/:name', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const { fields, indexes } = getModelSchemaDetailed(name);
    res.json({ name, fields, indexes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models/:name/data — fetch stored documents from MongoDB collection
router.get('/api/models/:name/data', async (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const rawLimit = parseInt(req.query.limit);
    const limit = rawLimit === 0 ? 0 : Math.min(rawLimit || 50, 500);
    const skip = parseInt(req.query.skip) || 0;
    const pascalName = toPascalCase(name);

    // Dynamically import mongoose from the project's node_modules
    const projectMongoose = path.join(process.cwd(), 'node_modules', 'mongoose', 'index.js');
    if (!fs.existsSync(projectMongoose)) {
      return res.status(400).json({ error: 'Mongoose is not installed. Set up MongoDB first.' });
    }
    const mongoose = (await import(pathToFileURL(projectMongoose).href)).default;

    // Connect if not already connected
    if (mongoose.connection.readyState === 0) {
      const uri = getEnvValue(path.join(process.cwd(), '.env'), 'MONGO_URI');
      if (!uri) return res.status(400).json({ error: 'MONGO_URI not configured.' });
      await mongoose.connect(uri);
    }

    const collection = mongoose.connection.db.collection(name + 's');
    const total = await collection.countDocuments();
    const query = collection.find({}).skip(skip);
    if (limit > 0) query.limit(limit);
    const docs = await query.toArray();

    res.json({ docs, total, limit, skip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models/:name/share — generate shareable endpoint documentation
router.get('/api/models/:name/share', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const { fields } = getModelSchemaDetailed(name);
    const routes = listRoutes();
    const routeFile = routes.find(r => r === name + '.js' || r === name + 's.js');

    let endpoints = [];
    if (routeFile) {
      const filePath = path.join(process.cwd(), 'src', 'routes', routeFile);
      const content = fs.readFileSync(filePath, 'utf8');
      const regex = /router\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*?)['"`]/gi;
      let m;
      while ((m = regex.exec(content)) !== null) {
        endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
      }
    }

    // Determine the route prefix
    const indexPath = path.join(process.cwd(), 'index.js');
    let prefix = '/api/' + name;
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      const prefixMatch = indexContent.match(new RegExp(`app\\.use\\(['"](\\/[^'"]+)['"].*${routeFile ? routeFile.replace('.js', '') : name}`));
      if (prefixMatch) prefix = prefixMatch[1];
    }

    res.json({ name, fields, endpoints, prefix, routeFile: routeFile || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/models
router.post('/api/models', (req, res) => {
  try {
    if (!checkMongoConfig()) {
      return res.status(400).json({ error: 'Database must be configured before creating schemas. Set up MongoDB first.' });
    }

    const { name, fields, indexes } = req.body;
    const safeName = sanitizeName(name);
    const pascalName = toPascalCase(safeName);

    const modelsDir = path.join(process.cwd(), 'src', 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const filePath = path.join(modelsDir, safeName + '.js');
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: `Model "${safeName}" already exists.` });
    }

    const content = generateSchemaFileContent(pascalName, fields, indexes);
    fs.writeFileSync(filePath, content, 'utf8');
    refreshDocsSpec();
    res.json({ message: `Model "${safeName}" created.`, file: `src/models/${safeName}.js` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/models/:name
router.put('/api/models/:name', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const { fields, indexes } = req.body;
    const pascalName = toPascalCase(name);

    const filePath = path.join(process.cwd(), 'src', 'models', name + '.js');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Model "${name}" not found.` });
    }

    const content = generateSchemaFileContent(pascalName, fields, indexes);
    fs.writeFileSync(filePath, content, 'utf8');
    refreshDocsSpec();
    res.json({ message: `Model "${name}" updated.`, file: `src/models/${name}.js` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/models/:name
router.delete('/api/models/:name', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const filePath = path.join(process.cwd(), 'src', 'models', name + '.js');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Model "${name}" not found.` });
    }

    fs.unlinkSync(filePath);
    refreshDocsSpec();
    res.json({ message: `Model "${name}" deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/routes
router.get('/api/routes', (req, res) => {
  try {
    const routes = listRoutes();
    res.json(routes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/routes/:name/content
router.get('/api/routes/:name/content', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const filePath = path.join(process.cwd(), 'src', 'routes', name + '.js');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Route file "${name}.js" not found.` });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ name, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/routes/:name
router.delete('/api/routes/:name', (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const routeFile = name + '.js';
    const safeName = name;
    const filePath = path.join(process.cwd(), 'src', 'routes', routeFile);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Route file "${routeFile}" not found.` });
    }

    // Find the Zod validator this route uses (if any) before deleting the route,
    // so we can clean it up too — otherwise validators/<name>.js is orphaned.
    let validatorPath = null;
    try {
      const routeContent = fs.readFileSync(filePath, 'utf8');
      const vi = routeContent.match(/from\s+['"]\.\.\/validators\/([\w-]+)(?:\.js)?['"]/);
      if (vi) validatorPath = path.join(process.cwd(), 'src', 'validators', vi[1] + '.js');
    } catch {}

    // Delete the route file
    fs.unlinkSync(filePath);
    // Delete its validator (only this route used it — validators are 1:1 with routes).
    if (validatorPath && fs.existsSync(validatorPath)) {
      try { fs.unlinkSync(validatorPath); } catch {}
    }
    refreshDocsSpec();

    // Send response BEFORE modifying index.js (nodemon restart kills connection)
    res.json({ message: `Route "${safeName}" deleted successfully.` });

    // Remove import and registration from index.js
    const indexPath = path.join(process.cwd(), 'index.js');
    if (fs.existsSync(indexPath)) {
      let indexContent = fs.readFileSync(indexPath, 'utf8');
      // Remove import line
      indexContent = indexContent.replace(new RegExp(`import\\s+\\w+Router\\s+from\\s+['\"]\\./src/routes/${escapeRegExp(safeName)}\\.js['\"];?\\n?`, 'g'), '');
      // Remove app.use registration line
      indexContent = indexContent.replace(new RegExp(`app\\.use\\(['\"][^'\"]*${escapeRegExp(safeName)}['\"],\\s*\\w+Router\\);?\\n?`, 'g'), '');
      fs.writeFileSync(indexPath, indexContent, 'utf8');
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/routes/:name/add-method — add handlers to existing route
// ---------------------------------------------------------------------------
router.post('/api/routes/:name/add-method', async (req, res) => {
  try {
    const name = safeStem(req.params.name);
    const routeFile = name + '.js';
    const filePath = path.join(process.cwd(), 'src', 'routes', routeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Route file "${routeFile}" not found.` });
    }

    const { routeType = 'methods', methods: methodList = [], modelName, loginField, passwordField, registerFields = [], selectedFields = [], customFields = [] } = req.body;
    const pascalModel = modelName ? toPascalCase(modelName) : '';
    const hasPassword = !!passwordField;
    const findField = loginField || 'email';

    let content = fs.readFileSync(filePath, 'utf8');

    // Check for duplicate methods
    const existingMethods = [];
    const existCheck = /router\.(get|post|put|patch|delete)\(/gi;
    let em;
    while ((em = existCheck.exec(content)) !== null) existingMethods.push(em[1].toLowerCase());

    const newMethods = methodList.filter(m => !existingMethods.includes(m.toLowerCase()));

    // Helper: add import if not present
    function addImport(imp) {
      if (!content.includes(imp.split(' from ')[0])) {
        const lastImport = content.lastIndexOf('import ');
        const lineEnd = content.indexOf('\n', lastImport);
        content = content.slice(0, lineEnd + 1) + imp + '\n' + content.slice(lineEnd + 1);
      }
    }

    // Helper: insert handler before export
    function insertHandler(handler) {
      const exportIdx = content.lastIndexOf('export default router;');
      if (exportIdx !== -1) {
        content = content.slice(0, exportIdx) + handler + '\n\n' + content.slice(exportIdx);
      } else {
        content += '\n' + handler;
      }
    }

    let handlers = '';
    const packagesToInstall = [];

    if (routeType === 'methods') {
      if (newMethods.length === 0) {
        return res.status(400).json({ error: 'All selected methods already exist in this route.' });
      }

      const allFields = [...selectedFields.map(f => typeof f === 'string' ? { name: f, type: 'String' } : f), ...customFields];
      const fileFields = allFields.filter(f => f.type === 'File');
      const bodyFields = allFields.filter(f => f.type !== 'File');
      const hasFileFields = fileFields.length > 0;

      if (hasFileFields) {
        addImport("import multer from 'multer';");
        if (!content.includes('const upload = multer')) {
          content = content.replace('const router = express.Router();', "const router = express.Router();\n\nconst upload = multer({ dest: 'uploads/' });");
        }
        packagesToInstall.push('multer');
      }

      newMethods.forEach(m => {
        const dataSource = (m === 'get' || m === 'delete') ? 'req.query' : 'req.body';
        let mw = '';
        let destruct = '';

        if (hasFileFields && m !== 'get' && m !== 'delete') {
          if (fileFields.length === 1) mw = `upload.single('${fileFields[0].name}'), `;
          else mw = `upload.fields([${fileFields.map(f => `{ name: '${f.name}', maxCount: 1 }`).join(', ')}]), `;
        }
        if (bodyFields.length > 0) destruct += `  const { ${bodyFields.map(f => f.name).join(', ')} } = ${dataSource};\n`;
        if (hasFileFields && m !== 'get' && m !== 'delete') {
          if (fileFields.length === 1) destruct += `  const ${fileFields[0].name} = req.file;\n`;
          else fileFields.forEach(f => { destruct += `  const ${f.name} = req.files?.['${f.name}']?.[0];\n`; });
        }

        if (allFields.length > 0) {
          handlers += `\nrouter.${m}('/', ${mw}async (req, res) => {\n${destruct}\n  // TODO: Add your logic here\n\n  res.json({ msg: '${name} ${m.toUpperCase()} endpoint works' });\n});\n`;
        } else {
          handlers += `\nrouter.${m}('/', async (req, res) => {\n  res.json({ msg: '${name} ${m.toUpperCase()} endpoint works' });\n});\n`;
        }
      });

    } else if (routeType === 'crud' && modelName) {
      addImport(`import ${pascalModel} from '../models/${modelName}.js';`);
      const crudMethods = newMethods.length > 0 ? newMethods : ['get', 'post', 'put', 'delete'].filter(m => !existingMethods.includes(m));
      const allCrudFields = [...selectedFields.map(f => typeof f === 'string' ? { name: f, type: 'String' } : f), ...customFields];
      const crudBodyFields = allCrudFields.filter(f => f.type !== 'File');
      const crudFileFields = allCrudFields.filter(f => f.type === 'File');
      const crudHasFiles = crudFileFields.length > 0;
      const crudHasFields = allCrudFields.length > 0;

      if (crudHasFiles) {
        addImport("import multer from 'multer';");
        if (!content.includes('const upload = multer')) {
          content = content.replace('const router = express.Router();', "const router = express.Router();\n\nconst upload = multer({ dest: 'uploads/' });");
        }
        packagesToInstall.push('multer');
      }

      let dest = '';
      let obj = 'req.body';
      if (crudHasFields) {
        const parts = [];
        if (crudBodyFields.length > 0) {
          dest = `const { ${crudBodyFields.map(f => f.name).join(', ')} } = req.body;`;
          parts.push(...crudBodyFields.map(f => f.name));
        }
        if (crudFileFields.length > 0) {
          const fileLines = crudFileFields.map(f => {
            if (crudFileFields.length === 1) return `const ${f.name} = req.file ? req.file.path : undefined;`;
            return `const ${f.name} = req.files?.['${f.name}']?.[0]?.path || undefined;`;
          }).join('\\n    ');
          dest = (dest ? dest + '\\n    ' : '') + fileLines;
          parts.push(...crudFileFields.map(f => f.name));
        }
        obj = `{ ${parts.join(', ')} }`;
      }

      let mw = '';
      if (crudHasFiles) {
        if (crudFileFields.length === 1) mw = `upload.single('${crudFileFields[0].name}'), `;
        else mw = `upload.fields([${crudFileFields.map(f => `{ name: '${f.name}', maxCount: 1 }`).join(', ')}]), `;
      }

      if (crudMethods.includes('get')) {
        handlers += `\n// Get all\nrouter.get('/', async (req, res) => {\n  try {\n    const items = await ${pascalModel}.find();\n    res.json(items);\n  } catch (err) {\n    res.status(500).json({ message: err.message });\n  }\n});\n\n// Get by ID\nrouter.get('/:id', async (req, res) => {\n  try {\n    const item = await ${pascalModel}.findById(req.params.id);\n    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });\n    res.json(item);\n  } catch (err) {\n    res.status(500).json({ message: err.message });\n  }\n});\n`;
      }
      if (crudMethods.includes('post')) {
        handlers += `\n// Create\nrouter.post('/', ${mw}async (req, res) => {\n  try {\n    ${dest}\n    const item = new ${pascalModel}(${obj});\n    const saved = await item.save();\n    res.status(201).json(saved);\n  } catch (err) {\n    res.status(400).json({ message: err.message });\n  }\n});\n`;
      }
      if (crudMethods.includes('put')) {
        handlers += `\n// Update\nrouter.put('/:id', ${mw}async (req, res) => {\n  try {\n    ${dest}\n    const item = await ${pascalModel}.findByIdAndUpdate(req.params.id, ${obj}, { returnDocument: 'after', runValidators: true });\n    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });\n    res.json(item);\n  } catch (err) {\n    res.status(400).json({ message: err.message });\n  }\n});\n`;
      }
      if (crudMethods.includes('patch')) {
        handlers += `\n// Partial Update\nrouter.patch('/:id', ${mw}async (req, res) => {\n  try {\n    ${dest}\n    const item = await ${pascalModel}.findByIdAndUpdate(req.params.id, ${obj}, { returnDocument: 'after', runValidators: true });\n    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });\n    res.json(item);\n  } catch (err) {\n    res.status(400).json({ message: err.message });\n  }\n});\n`;
      }
      if (crudMethods.includes('delete')) {
        handlers += `\n// Delete\nrouter.delete('/:id', async (req, res) => {\n  try {\n    const item = await ${pascalModel}.findByIdAndDelete(req.params.id);\n    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });\n    res.json({ message: '${pascalModel} deleted' });\n  } catch (err) {\n    res.status(500).json({ message: err.message });\n  }\n});\n`;
      }

    } else if (routeType === 'login' && modelName) {
      addImport(`import ${pascalModel} from '../models/${modelName}.js';`);
      if (hasPassword) { addImport("import bcrypt from 'bcrypt';"); packagesToInstall.push('bcrypt'); }
      addImport("import jwt from 'jsonwebtoken';");
      packagesToInstall.push('jsonwebtoken');

      if (hasPassword) {
        handlers += `\n// Login\nrouter.post('/', async (req, res) => {\n  try {\n    const { ${findField}, ${passwordField} } = req.body;\n    const ${modelName} = await ${pascalModel}.findOne({ ${findField} });\n    if (!${modelName}) return res.status(401).json({ message: 'Invalid credentials' });\n\n    const isMatch = await bcrypt.compare(${passwordField}, ${modelName}.${passwordField});\n    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });\n\n    const token = jwt.sign({ id: ${modelName}._id }, process.env.JWT_SECRET, { expiresIn: '7d' });\n    res.json({ token, ${modelName}: { id: ${modelName}._id, ${findField}: ${modelName}.${findField} } });\n  } catch (err) {\n    res.status(500).json({ message: err.message });\n  }\n});\n`;
      } else {
        handlers += `\n// Login\nrouter.post('/', async (req, res) => {\n  try {\n    const { ${findField} } = req.body;\n    const ${modelName} = await ${pascalModel}.findOne({ ${findField} });\n    if (!${modelName}) return res.status(401).json({ message: 'Invalid credentials' });\n\n    const token = jwt.sign({ id: ${modelName}._id }, process.env.JWT_SECRET, { expiresIn: '7d' });\n    res.json({ token, ${modelName}: { id: ${modelName}._id, ${findField}: ${modelName}.${findField} } });\n  } catch (err) {\n    res.status(500).json({ message: err.message });\n  }\n});\n`;
      }

      // Ensure JWT_SECRET
      const envFile = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes('JWT_SECRET')) updateEnvFile(envFile, 'JWT_SECRET', crypto.randomBytes(32).toString('hex'));

    } else if (routeType === 'register' && modelName) {
      addImport(`import ${pascalModel} from '../models/${modelName}.js';`);
      if (hasPassword) { addImport("import bcrypt from 'bcrypt';"); packagesToInstall.push('bcrypt'); }
      addImport("import jwt from 'jsonwebtoken';");
      packagesToInstall.push('jsonwebtoken');

      const regFields = registerFields.length > 0 ? registerFields : [findField];
      const allDestructured = regFields.join(', ');

      if (hasPassword) {
        const nonPwFields = regFields.filter(f => f !== passwordField);
        handlers += `\n// Register\nrouter.post('/', async (req, res) => {\n  try {\n    const { ${allDestructured} } = req.body;\n    const existing = await ${pascalModel}.findOne({ ${findField} });\n    if (existing) return res.status(400).json({ message: '${pascalModel} already exists' });\n\n    const salt = await bcrypt.genSalt(10);\n    const hashedPassword = await bcrypt.hash(${passwordField}, salt);\n    const item = new ${pascalModel}({ ${nonPwFields.join(', ')}, ${passwordField}: hashedPassword });\n    const saved = await item.save();\n\n    const token = jwt.sign({ id: saved._id }, process.env.JWT_SECRET, { expiresIn: '7d' });\n    res.status(201).json({ token, ${modelName}: { id: saved._id, ${findField}: saved.${findField} } });\n  } catch (err) {\n    res.status(400).json({ message: err.message });\n  }\n});\n`;
      } else {
        handlers += `\n// Register\nrouter.post('/', async (req, res) => {\n  try {\n    const { ${allDestructured} } = req.body;\n    const existing = await ${pascalModel}.findOne({ ${findField} });\n    if (existing) return res.status(400).json({ message: '${pascalModel} already exists' });\n\n    const item = new ${pascalModel}({ ${allDestructured} });\n    const saved = await item.save();\n\n    const token = jwt.sign({ id: saved._id }, process.env.JWT_SECRET, { expiresIn: '7d' });\n    res.status(201).json({ token, ${modelName}: { id: saved._id, ${findField}: saved.${findField} } });\n  } catch (err) {\n    res.status(400).json({ message: err.message });\n  }\n});\n`;
      }

      const envFile = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes('JWT_SECRET')) updateEnvFile(envFile, 'JWT_SECRET', crypto.randomBytes(32).toString('hex'));
    }

    if (!handlers) {
      return res.status(400).json({ error: 'Nothing to add.' });
    }

    // Install packages
    if (packagesToInstall.length > 0) {
      await installDeps([...new Set(packagesToInstall)]);
    }

    insertHandler(handlers);
    fs.writeFileSync(filePath, content, 'utf8');
    refreshDocsSpec();

    const label = routeType === 'methods' ? newMethods.map(m => m.toUpperCase()).join(', ') : routeType.toUpperCase();
    res.json({ message: `${label} added to "${name}" route.`, content });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/crud/preview
router.post('/api/crud/preview', (req, res) => {
  try {
    const { modelName, routeFile, operations } = req.body;
    const pascalName = toPascalCase(modelName);
    const fields = getModelSchema(modelName);
    const routeFilePath = path.join(process.cwd(), 'src', 'routes', routeFile);

    let dataSource = 'req.body';
    if (fs.existsSync(routeFilePath)) {
      const method = detectHttpMethod(routeFilePath);
      dataSource = getRequestDataSource(method);
    }

    const needsBcrypt = fields.includes('password') &&
      (operations.includes('create') || operations.includes('update'));

    let code = '';

    // Import block
    let importBlock = `import ${pascalName} from '../models/${modelName}.js';`;
    if (needsBcrypt) {
      importBlock = `import bcrypt from 'bcrypt';\n${importBlock}`;
    }
    code += importBlock + '\n';

    if (operations.includes('create')) {
      code += buildInsertCode(pascalName, fields, dataSource) + '\n';
    }
    if (operations.includes('read')) {
      code += buildReadCode(pascalName) + '\n';
    }
    if (operations.includes('update')) {
      code += buildUpdateCode(pascalName, fields, dataSource) + '\n';
    }
    if (operations.includes('delete')) {
      code += buildDeleteCode(pascalName) + '\n';
    }

    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crud/generate
router.post('/api/crud/generate', (req, res) => {
  try {
    const { modelName, routeFile, operations } = req.body;
    const pascalName = toPascalCase(modelName);
    const fields = getModelSchema(modelName);
    const routeFilePath = path.join(process.cwd(), 'src', 'routes', routeFile);

    if (!fs.existsSync(routeFilePath)) {
      return res.status(404).json({ error: `Route file "${routeFile}" not found.` });
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields found in the selected model.' });
    }

    const method = detectHttpMethod(routeFilePath);
    const dataSource = getRequestDataSource(method);
    const needsBcrypt = fields.includes('password') &&
      (operations.includes('create') || operations.includes('update'));

    // Build import
    let importBlock = `import ${pascalName} from '../models/${modelName}.js';`;
    if (needsBcrypt) {
      importBlock = `import bcrypt from 'bcrypt';\n${importBlock}`;
    }
    addImportToRoute(routeFilePath, importBlock);

    // Add selected operations
    const added = [];

    if (operations.includes('create')) {
      insertCodeIntoRoute(routeFilePath, buildInsertCode(pascalName, fields, dataSource));
      added.push('POST /create');
    }

    if (operations.includes('read')) {
      insertCodeIntoRoute(routeFilePath, buildReadCode(pascalName));
      added.push('GET / and GET /:id');
    }

    if (operations.includes('update')) {
      insertCodeIntoRoute(routeFilePath, buildUpdateCode(pascalName, fields, dataSource));
      added.push('PUT /:id');
    }

    if (operations.includes('delete')) {
      insertCodeIntoRoute(routeFilePath, buildDeleteCode(pascalName));
      added.push('DELETE /:id');
    }

    res.json({
      message: `CRUD operations added to ${routeFile}`,
      model: modelName,
      routes: added,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/env
router.get('/api/env', (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/env
router.put('/api/env', (req, res) => {
  try {
    const { content } = req.body;
    const envPath = path.join(process.cwd(), '.env');
    fs.writeFileSync(envPath, content, 'utf8');
    res.json({ message: '.env updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Index.js manipulation helpers
// ---------------------------------------------------------------------------

function readIndexFile() {
  return fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8');
}

function writeIndexFile(content) {
  fs.writeFileSync(path.join(process.cwd(), 'index.js'), content, 'utf8');
}

// File-based wrappers around the shared pure index.js transforms in codegen.js.
function addImportToIndex(importLine) {
  writeIndexFile(addImportAfterLastImport(readIndexFile(), importLine));
}

function insertBeforeListen(codeBlock) {
  writeIndexFile(insertBeforeListenContent(readIndexFile(), codeBlock));
}

function replaceAppListen(newBlock) {
  let content = readIndexFile();
  if (content.includes('startServer(')) {
    content = content.replace(/const listener = app\.listen\(tryPort\)/, 'const listener = server.listen(tryPort)');
    if (!content.includes('server.listen(tryPort)')) {
      content = content.replace(/app\.listen\(tryPort\)/, 'server.listen(tryPort)');
    }
  } else {
    content = content.replace(/app\.listen\(port[\s\S]*?\}\);?\n?/m, newBlock.trim() + '\n');
  }
  writeIndexFile(content);
}

function removeSocketIOCode() {
  let content = readIndexFile();
  // Remove Socket.IO import
  content = content.replace(/import\s*\{\s*Server\s*\}\s*from\s*["']socket\.io["'];\s*\n?/g, '');
  // Remove http import only if WebSocket doesn't need it
  if (!content.includes('WebSocketServer({ server')) {
    content = content.replace(/import\s+http\s+from\s*["']http["'];\s*\n?/g, '');
  }
  // Remove server = http.createServer(app) only if WebSocket doesn't need it
  if (!content.includes('WebSocketServer({ server')) {
    content = content.replace(/const\s+server\s*=\s*http\.createServer\(app\);\s*\n?/g, '');
  }
  // Remove io setup block (use \n}); to match outer closing brace at column 0)
  content = content.replace(/const\s+io\s*=\s*new\s+Server\(server[\s\S]*?\n\}\);\s*\n?/g, '');
  // Remove io.on("connection"...) block (nested callbacks — match \n}); at column 0)
  content = content.replace(/io\.on\(["']connection["'][\s\S]*?\n\}\);\s*\n?/g, '');
  // Remove req.io middleware
  content = content.replace(/app\.use\(\(req,\s*res,\s*next\)\s*=>\s*\{\s*\n?\s*req\.io\s*=\s*io;\s*\n?\s*next\(\);\s*\n?\s*\}\);\s*\n?/g, '');
  // Replace server.listen back to app.listen if no WebSocket uses server
  if (!content.includes('WebSocketServer({ server') && content.includes('server.listen(port')) {
    content = content.replace(/server\.listen\(port[\s\S]*?\n\}\);?\s*\n?/m, `app.listen(port, () => {
  console.log(\`Server is running on port \${port}\`);
});\n`);
  }
  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  writeIndexFile(content);
}

function removeWebSocketCode() {
  let content = readIndexFile();
  // Remove ws import
  content = content.replace(/import\s*\{\s*WebSocketServer\s*\}\s*from\s*['"]ws['"];\s*\n?/g, '');
  // Remove WebSocketServer setup (both same-port and separate-port)
  content = content.replace(/const\s+wss\s*=\s*new\s+WebSocketServer\(\{[\s\S]*?\n?\}\);\s*\n?/g, '');
  // Remove wss.on('connection'...) block (nested callbacks — match \n}); at column 0)
  content = content.replace(/wss\.on\(['"]connection['"][\s\S]*?\n\}\);\s*\n?/g, '');
  // Remove console.log for WS port
  content = content.replace(/console\.log\(['"]WebSocket server running on port.*?['"]?\);\s*\n?/g, '');
  // Remove http import only if Socket.IO doesn't need it
  if (!content.includes('new Server(server')) {
    content = content.replace(/import\s+http\s+from\s*['"]http['"];\s*\n?/g, '');
  }
  // Remove server = http.createServer(app) only if Socket.IO doesn't need it
  if (!content.includes('new Server(server')) {
    content = content.replace(/const\s+server\s*=\s*http\.createServer\(app\);\s*\n?/g, '');
    // Replace server.listen back to app.listen
    if (content.includes('server.listen(port')) {
      content = content.replace(/server\.listen\(port[\s\S]*?\n\}\);?\s*\n?/m, `app.listen(port, () => {
  console.log(\`Server is running on port \${port}\`);
});\n`);
    }
  }
  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  writeIndexFile(content);
}

function updateEnvFile(filePath, key, value) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trimEnd() + '\n' + `${key}=${value}\n`;
    }
    fs.writeFileSync(filePath, content, 'utf8');
  } else {
    fs.writeFileSync(filePath, `${key}=${value}\n`, 'utf8');
  }
}

// Record packages in package.json so the app stays installable even if the live
// `npm install` below is offline/interrupted. Always call this BEFORE npm install.
function recordDeps(names, dev = false) {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const list = Array.isArray(names) ? names : [names];
    const { content, changed } = addDepsToPackageJson(fs.readFileSync(pkgPath, 'utf8'), list, { dev });
    if (changed) fs.writeFileSync(pkgPath, content, 'utf8');
  } catch {}
}

// Record deps then run npm install (best-effort). Replaces bare execAsync('npm install …').
async function installDeps(names, { dev = false } = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (list.length === 0) return;
  recordDeps(list, dev);
  try { await execAsync(`npm install ${dev ? '-D ' : ''}${list.join(' ')}`, { cwd: process.cwd() }); } catch {}
}

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------
router.get('/api/status', (req, res) => {
  try {
    const indexPath = path.join(process.cwd(), 'index.js');
    const indexContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';

    const mongoConfigured = indexContent.includes("import connectDB") || indexContent.includes("connectDB");
    const routesDirExists = fs.existsSync(path.join(process.cwd(), 'src', 'routes'));
    const authMiddlewareExists = fs.existsSync(path.join(process.cwd(), 'src', 'middleware', 'auth.js'));
    const socketConfigured = indexContent.includes('setupSocketIO') || indexContent.includes('socket.io') || indexContent.includes('Server(server');
    const websocketConfigured = indexContent.includes('setupWebSocket') || indexContent.includes('WebSocketServer') || indexContent.includes("from 'ws'");
    const serialportConfigured = indexContent.includes('SerialPort') || indexContent.includes("from 'serialport'");

    const mwExists = (f) => fs.existsSync(path.join(process.cwd(), 'src', 'middleware', f));
    const security = {
      helmet: indexContent.includes("from 'helmet'") || indexContent.includes('app.use(helmet'),
      rateLimit: indexContent.includes("from 'express-rate-limit'") || indexContent.includes('rateLimit('),
      errorHandler: mwExists('errorHandler.js'),
      roles: mwExists('roles.js'),
      validation: mwExists('validate.js'),
    };

    // Folder name, sanitized into a valid default database name (Mongo db names
    // can't contain / \ . " $ * < > : | ? or spaces).
    const appName = (path.basename(process.cwd()) || 'app')
      .replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'app';

    res.json({
      appName,
      mongoConfigured,
      routesDirExists,
      authMiddlewareExists,
      socketConfigured,
      websocketConfigured,
      serialportConfigured,
      security,
      aiConfigured: !!getActiveAiKey(),
      docsConfigured: fs.existsSync(path.join(process.cwd(), 'src', 'docs.js')),
      mailConfigured: fs.existsSync(path.join(process.cwd(), 'src', 'services', 'mailer.js'))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Security configuration
// ---------------------------------------------------------------------------
// GET/POST rate-limit config — stored in .env (read by index.js at startup).
router.get('/api/security/rate-limit', (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const windowMs = Number(getEnvValue(envPath, 'RATE_LIMIT_WINDOW_MS')) || 15 * 60 * 1000;
    const max = Number(getEnvValue(envPath, 'RATE_LIMIT_MAX')) || 500;
    res.json({ windowMinutes: Math.max(1, Math.round(windowMs / 60000)), max });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post('/api/security/rate-limit', (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const windowMinutes = Math.max(1, Math.min(1440, Number(req.body && req.body.windowMinutes) || 15));
    const max = Math.max(1, Math.min(1000000, Number(req.body && req.body.max) || 500));
    updateEnvFile(envPath, 'RATE_LIMIT_WINDOW_MS', String(windowMinutes * 60000));
    updateEnvFile(envPath, 'RATE_LIMIT_MAX', String(max));
    res.json({ message: 'Rate limit updated.', windowMinutes, max });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Bonjour / mDNS discovery — advertise this app + browse the LAN
// ---------------------------------------------------------------------------
// The advertising itself lives in src/discovery.js and runs inside THIS process
// (started by index.js). We load that exact module by absolute path so the
// dashboard reads the very same live state — not a second, disconnected copy.
function loadDiscovery() {
  const url = pathToFileURL(path.join(process.cwd(), 'src', 'discovery.js')).href;
  return import(url);
}
const safeServiceType = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);

// Current advertisement state + whether mDNS is available in this project.
router.get('/api/discovery', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const enabled = getEnvValue(envPath, 'BONJOUR_ENABLED') !== 'off';
    const name = getEnvValue(envPath, 'BONJOUR_NAME');
    const type = getEnvValue(envPath, 'BONJOUR_TYPE') || 'http';
    const mod = await loadDiscovery().catch(() => null);
    const self = mod && mod.getSelfState ? mod.getSelfState() : null;
    res.json({ available: !!mod, enabled, config: { name, type }, self });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Browse the local network for services of a given type.
router.get('/api/discovery/browse', async (req, res) => {
  try {
    const mod = await loadDiscovery().catch(() => null);
    if (!mod || !mod.browse) return res.json({ available: false, services: [] });
    const type = safeServiceType(req.query.type) || 'http';
    const result = await mod.browse({ type, timeoutMs: 2500 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Persist discovery settings to .env AND apply them live. Because the discovery
// module runs in this very process, we can re-advertise immediately instead of
// waiting for a restart: mutate the live process.env (so isDiscoveryEnabled and
// the auto-name reflect the change), then re-publish / unpublish in place.
router.post('/api/discovery/config', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') {
      const v = b.enabled ? 'on' : 'off';
      updateEnvFile(envPath, 'BONJOUR_ENABLED', v);
      process.env.BONJOUR_ENABLED = v;
    }
    if (typeof b.name === 'string') {
      const clean = b.name.replace(/[\r\n]/g, '').trim().slice(0, 63);
      updateEnvFile(envPath, 'BONJOUR_NAME', clean);
      process.env.BONJOUR_NAME = clean;
    }
    if (typeof b.type === 'string' && b.type.trim()) {
      const t = safeServiceType(b.type) || 'http';
      updateEnvFile(envPath, 'BONJOUR_TYPE', t);
      process.env.BONJOUR_TYPE = t;
    }

    // Apply live in the running process.
    let self = null;
    const mod = await loadDiscovery().catch(() => null);
    if (mod) {
      if (process.env.BONJOUR_ENABLED === 'off') {
        if (mod.stopAdvertising) await mod.stopAdvertising();
      } else if (mod.startAdvertising) {
        const st = mod.getSelfState ? mod.getSelfState() : {};
        const port = st.port || Number(process.env.PORT) || (req.socket && req.socket.localPort);
        await mod.startAdvertising({
          port,
          name: process.env.BONJOUR_NAME || undefined,
          type: process.env.BONJOUR_TYPE || undefined,
        });
      }
      self = mod.getSelfState ? mod.getSelfState() : null;
    }

    res.json({ message: 'Discovery settings applied.', self });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Email (nodemailer) — provider presets, SMTP config in .env, install + test
// ---------------------------------------------------------------------------
const mailerFilePath = () => path.join(process.cwd(), 'src', 'services', 'mailer.js');

// Constant-time check of the shared 4brains.in authorization password.
function officialDomainAuthorized(supplied) {
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(OFFICIAL_MAIL_DOMAIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Report that a 4brains.in sender was configured — who (machine/app) and which
// email id — to the official notify address, using the just-saved provider.
async function notifyOfficialDomain(envPath, provider, fromAddr) {
  let appName = 'unknown';
  try { appName = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).name || appName; } catch {}
  let osUser = 'unknown';
  try { osUser = os.userInfo().username; } catch {}
  const subject = '[4bnode] 4brains.in sender configured: ' + fromAddr;
  const text = [
    'A 4brains.in sender was configured in a 4bnode app.',
    '',
    'Email id (from): ' + fromAddr,
    'Provider: ' + provider,
    'Configured by: ' + osUser + '@' + os.hostname(),
    'App: ' + appName,
    'Time: ' + new Date().toISOString(),
  ].join('\n');

  if (provider === 'resend') {
    const { Resend } = await import('resend');
    const resend = new Resend(getEnvValue(envPath, 'RESEND_API_KEY'));
    const { error } = await resend.emails.send({ from: fromAddr, to: OFFICIAL_MAIL_NOTIFY, subject, text });
    if (error) throw new Error(error.message || 'Resend notify failed');
    return;
  }
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: getEnvValue(envPath, 'SMTP_HOST'),
    port: Number(getEnvValue(envPath, 'SMTP_PORT')) || 587,
    secure: getEnvValue(envPath, 'SMTP_SECURE') === 'true',
    auth: { user: getEnvValue(envPath, 'SMTP_USER'), pass: getEnvValue(envPath, 'SMTP_PASS') },
  });
  await transporter.sendMail({ from: fromAddr, to: OFFICIAL_MAIL_NOTIFY, subject, text });
}

// Verify a saved mail config actually works: an SMTP handshake, or a lightweight
// authenticated Resend call. Throws with a readable message on failure. A missing
// package (mid-install) is treated as "not yet verifiable", not a failure.
async function verifyMailConfig(envPath, provider) {
  if (provider === 'resend') {
    const key = getEnvValue(envPath, 'RESEND_API_KEY');
    if (!key) throw new Error('Resend API key is missing.');
    // Resend has no safe no-op verify — domains.list() needs a full-access key and
    // rejects normal send-only keys, which would fail valid configs. So validate the
    // key shape + From here, and let the "Send test" button confirm deliverability.
    if (!/^re_/.test(key)) throw new Error('That does not look like a Resend API key — it should start with "re_".');
    if (!getEnvValue(envPath, 'MAIL_FROM')) throw new Error('A From address is required for Postmaster.');
    return;
  }
  const host = getEnvValue(envPath, 'SMTP_HOST');
  if (!host) throw new Error('SMTP host is missing.');
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; } catch { return; }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(getEnvValue(envPath, 'SMTP_PORT')) || 587,
    secure: getEnvValue(envPath, 'SMTP_SECURE') === 'true',
    auth: { user: getEnvValue(envPath, 'SMTP_USER'), pass: getEnvValue(envPath, 'SMTP_PASS') },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
  });
  await transporter.verify();
}

// GET /api/mail — current config + the two providers for the Email page.
router.get('/api/mail', (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const provider = (getEnvValue(envPath, 'MAIL_PROVIDER') || 'resend').toLowerCase();
    res.json({
      configured: fs.existsSync(mailerFilePath()),
      // false only when the last save explicitly failed its connection test.
      verified: getEnvValue(envPath, 'MAIL_VERIFIED') !== 'false',
      provider: MAIL_PROVIDERS[provider] ? provider : 'resend',
      providers: Object.entries(MAIL_PROVIDERS).map(([id, p]) => ({ id, ...p })),
      resend: {
        from: getEnvValue(envPath, 'MAIL_FROM'),
        hasKey: !!getEnvValue(envPath, 'RESEND_API_KEY'),
      },
      smtp: {
        host: getEnvValue(envPath, 'SMTP_HOST'),
        port: Number(getEnvValue(envPath, 'SMTP_PORT')) || 587,
        secure: getEnvValue(envPath, 'SMTP_SECURE') === 'true',
        user: getEnvValue(envPath, 'SMTP_USER'),
        from: getEnvValue(envPath, 'SMTP_FROM'),
        hasPass: !!getEnvValue(envPath, 'SMTP_PASS'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mail/setup — save config to .env, write mailer.js, install the backend.
// Body: { provider: 'resend'|'smtp', ... }. resend → { apiKey, from }; smtp → { host, port, secure, user, pass, from }.
router.post('/api/mail/setup', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const provider = String((req.body && req.body.provider) || 'resend').toLowerCase();
    if (!MAIL_PROVIDERS[provider]) return res.status(400).json({ error: 'Unknown mail provider.' });

    // Gate the official 4brains.in domain: it may not be used directly. Require the
    // shared authorization password before saving a 4brains.in sender.
    const b = req.body || {};
    // Any field that references the official 4brains.in domain (from, user, or host)
    // triggers the gate — not just the sender. Guards against slipping it into Host.
    const officialValue = [b.from, b.user, b.host].map((v) => String(v || '').trim()).find((v) => /4brains\.in/i.test(v)) || '';
    const official = !!officialValue;
    if (official && !officialDomainAuthorized(b.domainPassword)) {
      return res.status(403).json({
        error: 'This uses the official 4brains.in domain — you can’t use it directly. Enter the authorization password to continue.',
        requiresDomainPassword: true,
      });
    }

    // Persist to .env first (a .env write does NOT restart nodemon). Blank secret keeps the saved one.
    updateEnvFile(envPath, 'MAIL_PROVIDER', provider);
    // Mark an authorized official-domain configuration so the mailer's runtime
    // guard allows sending from 4brains.in (direct/code use stays blocked).
    if (official) updateEnvFile(envPath, 'OFFICIAL_MAIL_AUTHORIZED', '1');

    if (provider === 'resend') {
      const { apiKey, from } = req.body || {};
      if (from !== undefined) updateEnvFile(envPath, 'MAIL_FROM', String(from || '').trim());
      if (apiKey) updateEnvFile(envPath, 'RESEND_API_KEY', String(apiKey).trim());
      if (!getEnvValue(envPath, 'RESEND_API_KEY')) return res.status(400).json({ error: 'A Resend API key is required.' });
      if (!getEnvValue(envPath, 'MAIL_FROM')) return res.status(400).json({ error: 'A From address is required.' });
      await installDeps('resend');
    } else {
      const { host, port, secure, user, pass, from } = req.body || {};
      if (!host || !String(host).trim()) return res.status(400).json({ error: 'SMTP host is required.' });
      updateEnvFile(envPath, 'SMTP_HOST', String(host).trim());
      updateEnvFile(envPath, 'SMTP_PORT', String(port || (secure ? 465 : 587)).trim());
      updateEnvFile(envPath, 'SMTP_SECURE', secure ? 'true' : 'false');
      updateEnvFile(envPath, 'SMTP_USER', String(user || '').trim());
      if (pass) updateEnvFile(envPath, 'SMTP_PASS', String(pass));
      updateEnvFile(envPath, 'SMTP_FROM', String(from || user || '').trim());
      await installDeps('nodemailer');
    }

    // Verify the saved config actually works before declaring success, so wrong
    // credentials surface immediately instead of failing silently at send time.
    let verified = true, verifyError = '';
    try {
      await verifyMailConfig(envPath, provider);
    } catch (e) {
      verified = false;
      verifyError = e.message || 'Connection test failed.';
    }
    updateEnvFile(envPath, 'MAIL_VERIFIED', verified ? 'true' : 'false');

    // Report any authorized use of the official 4brains.in domain (best-effort).
    let note = '';
    if (official) {
      try { await notifyOfficialDomain(envPath, provider, officialValue); note = ' The domain owner has been notified.'; }
      catch (e) { note = ' (Could not send the domain notification: ' + e.message + ')'; }
    }

    // Respond BEFORE writing mailer.js (that write restarts nodemon).
    if (verified) {
      res.json({ verified: true, message: 'Email configured. Use sendMail({ to, subject, html }) from src/services/mailer.js.' + note });
    } else {
      res.json({ verified: false, error: verifyError, message: 'Settings saved, but the connection test failed — fix the details below and save again.' + note });
    }

    // Write/upgrade the mailer service last. Upgrade old single-backend mailers to
    // the dual-backend version.
    fs.mkdirSync(path.join(process.cwd(), 'src', 'services'), { recursive: true });
    const needsWrite = !fs.existsSync(mailerFilePath()) || !fs.readFileSync(mailerFilePath(), 'utf8').includes('MAIL_PROVIDER');
    if (needsWrite) fs.writeFileSync(mailerFilePath(), buildMailerService(), 'utf8');
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/mail/test — send a test email using the saved provider config.
router.post('/api/mail/test', async (req, res) => {
  try {
    const to = String((req.body && req.body.to) || '').trim();
    if (!to) return res.status(400).json({ error: 'Recipient is required.' });
    const envPath = path.join(process.cwd(), '.env');
    const provider = (getEnvValue(envPath, 'MAIL_PROVIDER') || 'resend').toLowerCase();

    if (provider === 'resend') {
      const key = getEnvValue(envPath, 'RESEND_API_KEY');
      if (!key) return res.status(400).json({ error: 'Set a Resend API key first.' });
      let Resend;
      try { ({ Resend } = await import('resend')); }
      catch { return res.status(400).json({ error: 'resend is still installing. Wait a moment after saving, then retry.' }); }
      const from = getEnvValue(envPath, 'MAIL_FROM');
      if (!from) return res.status(400).json({ error: 'Set a From address (MAIL_FROM) before sending a test.' });
      const resend = new Resend(key);
      const { error } = await resend.emails.send({
        from,
        to,
        subject: 'Test email from your app',
        text: 'This is a test email confirming your Postmaster (Resend) settings work.',
        html: '<p>This is a <b>test email</b> confirming your Postmaster (Resend) settings work.</p>',
      });
      if (error) return res.status(500).json({ error: 'Send failed: ' + (error.message || 'Resend error') });
      return res.json({ message: `Test email sent to ${to}.` });
    }

    const host = getEnvValue(envPath, 'SMTP_HOST');
    if (!host) return res.status(400).json({ error: 'Email is not configured yet — save SMTP settings first.' });
    let nodemailer;
    try { nodemailer = (await import('nodemailer')).default; }
    catch { return res.status(400).json({ error: 'nodemailer is still installing. Wait a moment after saving, then retry.' }); }
    // Build the transport from .env directly (process.env may be stale post-setup).
    const transporter = nodemailer.createTransport({
      host,
      port: Number(getEnvValue(envPath, 'SMTP_PORT')) || 587,
      secure: getEnvValue(envPath, 'SMTP_SECURE') === 'true',
      auth: { user: getEnvValue(envPath, 'SMTP_USER'), pass: getEnvValue(envPath, 'SMTP_PASS') },
    });
    await transporter.sendMail({
      from: getEnvValue(envPath, 'SMTP_FROM') || getEnvValue(envPath, 'SMTP_USER'),
      to,
      subject: 'Test email from your app',
      text: 'This is a test email confirming your SMTP settings work.',
      html: '<p>This is a <b>test email</b> confirming your SMTP settings work.</p>',
    });
    res.json({ message: `Test email sent to ${to}.` });
  } catch (err) {
    res.status(500).json({ error: 'Send failed: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// AI Builder — describe a backend in English, generate models + CRUD routes
// ---------------------------------------------------------------------------
// Currently selected provider (AI_PROVIDER in .env), validated against AI_PROVIDERS.
function getAiProvider() {
  const fromFile = getEnvValue(path.join(process.cwd(), '.env'), 'AI_PROVIDER');
  const id = (fromFile && fromFile.trim()) || (process.env.AI_PROVIDER && process.env.AI_PROVIDER.trim()) || DEFAULT_AI_PROVIDER;
  return AI_PROVIDERS[id] ? id : DEFAULT_AI_PROVIDER;
}

function getProviderKey(providerId) {
  const provider = AI_PROVIDERS[providerId];
  if (!provider) return '';
  const fromEnv = process.env[provider.keyEnv];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return getEnvValue(path.join(process.cwd(), '.env'), provider.keyEnv);
}

// Active provider's API key (used by the plan endpoint).
function getActiveAiKey() {
  return getProviderKey(getAiProvider());
}

// Effective model: explicit AI_MODEL override, else the active provider's default.
function getAiModel(providerId) {
  const fromFile = getEnvValue(path.join(process.cwd(), '.env'), 'AI_MODEL');
  const override = (fromFile && fromFile.trim()) || (process.env.AI_MODEL && process.env.AI_MODEL.trim());
  return override || AI_PROVIDERS[providerId].defaultModel;
}

// Fields for a route's model — from the plan if present, else from an existing model on disk.
function fieldsForModel(modelName, plan) {
  const inPlan = (plan.models || []).find((m) => m.name === modelName);
  if (inPlan) return inPlan.fields.map((f) => f.name);
  return getModelSchema(modelName);
}

// ── OpenAI: chat completions with a forced function call ──
async function callOpenAIPlan(prompt, model, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'function', function: { name: 'emit_plan', description: 'Emit the backend plan to generate.', parameters: AI_PLAN_SCHEMA } }],
      tool_choice: { type: 'function', function: { name: 'emit_plan' } },
    }),
  });
  let data;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    const e = new Error((data && data.error && data.error.message) || `OpenAI API error (${resp.status})`);
    e.status = resp.status === 401 ? 401 : 502;
    throw e;
  }
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error('The model did not return a structured plan. Try rephrasing.');
  try { return JSON.parse(toolCall.function.arguments); }
  catch { throw new Error('The model returned an unparseable plan. Try again.'); }
}

// ── Anthropic: messages with a forced tool call ──
async function callAnthropicPlan(prompt, model, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: AI_SYSTEM_PROMPT,
      tools: [{ name: 'emit_plan', description: 'Emit the backend plan to generate.', input_schema: AI_PLAN_SCHEMA }],
      tool_choice: { type: 'tool', name: 'emit_plan' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  let data;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    const e = new Error((data && data.error && data.error.message) || `Anthropic API error (${resp.status})`);
    e.status = resp.status === 401 ? 401 : 502;
    throw e;
  }
  const toolUse = Array.isArray(data.content) ? data.content.find((c) => c.type === 'tool_use') : null;
  if (!toolUse) throw new Error('The model did not return a structured plan. Try rephrasing.');
  return toolUse.input;
}

// Dispatch a plan request to the active provider.
async function callAiPlan(prompt) {
  const providerId = getAiProvider();
  const apiKey = getProviderKey(providerId);
  if (!apiKey) {
    const e = new Error(`No ${AI_PROVIDERS[providerId].label} API key configured. Add it in AI Builder settings.`);
    e.status = 400;
    throw e;
  }
  const model = getAiModel(providerId);
  return providerId === 'anthropic'
    ? callAnthropicPlan(prompt, model, apiKey)
    : callOpenAIPlan(prompt, model, apiKey);
}

// GET /api/ai/config — active provider, effective model, and per-provider status
router.get('/api/ai/config', (req, res) => {
  try {
    const provider = getAiProvider();
    const providers = Object.values(AI_PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      keyPlaceholder: p.keyPlaceholder,
      keysUrl: p.keysUrl,
      defaultModel: p.defaultModel,
      configured: !!getProviderKey(p.id),
    }));
    res.json({ provider, model: getAiModel(provider), providers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/key — save a provider's API key and make it the active provider
router.post('/api/ai/key', (req, res) => {
  try {
    const providerId = (req.body && req.body.provider ? String(req.body.provider) : '').trim();
    const key = (req.body && req.body.key ? String(req.body.key) : '').trim();
    const provider = AI_PROVIDERS[providerId];
    if (!provider) return res.status(400).json({ error: 'Unknown provider.' });
    if (!key) return res.status(400).json({ error: 'API key is required.' });

    const envPath = path.join(process.cwd(), '.env');
    updateEnvFile(envPath, provider.keyEnv, key);
    updateEnvFile(envPath, 'AI_PROVIDER', providerId);
    process.env[provider.keyEnv] = key; // usable immediately, no restart
    process.env.AI_PROVIDER = providerId;
    res.json({ message: `${provider.label} key saved and selected.`, provider: providerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/provider — switch the active provider (key must already exist)
router.post('/api/ai/provider', (req, res) => {
  try {
    const providerId = (req.body && req.body.provider ? String(req.body.provider) : '').trim();
    const provider = AI_PROVIDERS[providerId];
    if (!provider) return res.status(400).json({ error: 'Unknown provider.' });
    if (!getProviderKey(providerId)) {
      return res.status(400).json({ error: `Add a ${provider.label} key first.` });
    }
    updateEnvFile(path.join(process.cwd(), '.env'), 'AI_PROVIDER', providerId);
    process.env.AI_PROVIDER = providerId;
    res.json({ message: `Switched to ${provider.label}.`, provider: providerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/plan — turn a prompt into a normalized plan + code previews
router.post('/api/ai/plan', async (req, res) => {
  try {
    const prompt = (req.body && req.body.prompt ? String(req.body.prompt) : '').trim();
    if (!prompt) return res.status(400).json({ error: 'Describe what you want to build.' });

    const raw = await callAiPlan(prompt);
    const plan = normalizeAiPlan(raw);
    if (plan.models.length === 0 && plan.routes.length === 0) {
      return res.status(422).json({ error: 'Could not derive a buildable plan. Try being more specific.' });
    }

    const preview = {
      summary: plan.summary,
      models: plan.models.map((m) => ({
        name: m.name,
        fields: m.fields,
        code: generateMongooseModel(toPascalCase(m.name), m.fields),
      })),
      routes: plan.routes.map((r) => ({
        name: r.name,
        model: r.model,
        operations: r.operations,
        code: buildCrudRouteFile(r.name, r.model, fieldsForModel(r.model, plan), r.operations),
      })),
    };
    res.json({ plan, preview });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/ai/apply — generate the model + route files from an approved plan
router.post('/api/ai/apply', async (req, res) => {
  try {
    const plan = normalizeAiPlan(req.body && req.body.plan ? req.body.plan : {});
    if (plan.models.length === 0 && plan.routes.length === 0) {
      return res.status(400).json({ error: 'Empty plan.' });
    }
    if (!checkMongoConfig()) {
      return res.status(400).json({ error: 'Configure MongoDB before generating models.' });
    }

    const created = { models: [], routes: [], skipped: [] };

    const modelsDir = path.join(process.cwd(), 'src', 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    for (const m of plan.models) {
      const file = path.join(modelsDir, m.name + '.js');
      if (fs.existsSync(file)) { created.skipped.push('model:' + m.name); continue; }
      fs.writeFileSync(file, generateMongooseModel(toPascalCase(m.name), m.fields), 'utf8');
      created.models.push(m.name);
    }

    const routesDir = path.join(process.cwd(), 'src', 'routes');
    fs.mkdirSync(routesDir, { recursive: true });
    for (const r of plan.routes) {
      const file = path.join(routesDir, r.name + '.js');
      if (fs.existsSync(file)) { created.skipped.push('route:' + r.name); continue; }
      const fields = fieldsForModel(r.model, plan);
      fs.writeFileSync(file, buildCrudRouteFile(r.name, r.model, fields, r.operations), 'utf8');
      created.routes.push(r.name);
      const camel = toCamelCase(r.name);
      addImportToIndex(`import ${camel}Router from './src/routes/${r.name}.js';`);
      const reg = `app.use('/api/${r.name}', ${camel}Router);`;
      if (!readIndexFile().includes(reg)) insertBeforeListen(reg);
    }

    const anyPassword = plan.routes.some((r) => fieldsForModel(r.model, plan).includes('password'));
    if (anyPassword) {
      await installDeps(['bcrypt']);
    }

    res.json({
      message: `Generated ${created.models.length} model(s) and ${created.routes.length} route(s).`,
      ...created,
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Documentation (OpenAPI spec + self-contained docs page at /docs)
// ---------------------------------------------------------------------------
function projectTitle() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.name || 'API';
  } catch { return 'API'; }
}

// All models → { name, fields[] } for the OpenAPI components/schemas.
function collectModels() {
  const dir = path.join(process.cwd(), 'src', 'models');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => {
    const name = f.replace(/\.js$/, '');
    const detailed = getModelSchemaDetailed(name);
    return { name, fields: (detailed && detailed.fields) || [] };
  });
}

// Parse every route file into endpoint descriptors (method, path, params, query,
// body fields with model types) for the OpenAPI builder.
function collectEndpoints() {
  const routesDir = path.join(process.cwd(), 'src', 'routes');
  if (!fs.existsSync(routesDir)) return [];
  const indexPath = path.join(process.cwd(), 'index.js');
  const indexContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const out = [];
  fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).forEach((file) => {
    const name = file.replace(/\.js$/, '');
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');

    let prefix = '/api/' + name;
    const reg = indexContent.match(new RegExp("app\\.use\\(['\"]([^'\"]+)['\"]\\s*,\\s*\\w+Router\\s*\\)[^\\n]*" + name, 'i'))
      || indexContent.match(new RegExp("app\\.use\\(['\"]([^'\"]+)['\"]\\s*,\\s*" + toCamelCase(name) + "Router"));
    if (reg) prefix = reg[1];

    const modelImportMatch = content.match(/import\s+(\w+)\s+from\s+['"]\.\.\/models\/(\w+)['"]/);
    const modelFields = modelImportMatch ? (getModelSchemaDetailed(modelImportMatch[2]).fields || []) : [];

    // The API's real required-ness comes from the Zod validator (what actually
    // gates the request), not the Mongoose model. Parse the route's validator file
    // so OpenAPI `required` reflects the API contract, not the DB schema.
    const validatorImport = content.match(/from\s+['"]\.\.\/validators\/([\w-]+)(?:\.js)?['"]/);
    let validatorReq = null;
    if (validatorImport) {
      const vPath = path.join(process.cwd(), 'src', 'validators', validatorImport[1] + '.js');
      if (fs.existsSync(vPath)) {
        try { validatorReq = requiredFieldsFromZod(fs.readFileSync(vPath, 'utf8')); } catch {}
      }
    }

    const epRegex = /router\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*?)['"`]\s*,\s*([\s\S]*?)(?=\nrouter\.|\nexport |$)/gi;
    let m;
    while ((m = epRegex.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      const epath = m[2];
      const body = m[3] || '';
      // PATCH wires `validate(schema.partial())`, making every field optional.
      const usesPartial = /\.partial\s*\(\s*\)/.test(body);
      const bodyFields = extractRequestFields(body, 'body').map((fn) => {
        const meta = modelFields.find((x) => x.name === fn);
        let required;
        if (usesPartial) required = false;
        else if (validatorReq && Object.prototype.hasOwnProperty.call(validatorReq, fn)) required = validatorReq[fn];
        else required = !!(meta && meta.required);
        return { name: fn, type: (meta && meta.type) || 'String', required };
      });
      const queryFields = extractRequestFields(body, 'query').map((fn) => ({ name: fn, type: 'String' }));
      const params = (epath.match(/:(\w+)/g) || []).map((p) => p.slice(1));
      // Auth is detected by the `auth` middleware on the route — NOT by scanning the
      // handler for "jwt"/"bearer", which would wrongly flag login/register routes
      // (they *sign* a JWT to return it; they don't *require* a Bearer token).
      const hasAuth = /\bauth\b\s*,/.test(body);
      // Detect multer file fields so the docs show a multipart upload + file inputs.
      const fileFields = extractFileFields(body);
      const fullPath = (prefix + (epath === '/' ? '' : epath)).replace(/\/{2,}/g, '/');
      out.push({ method, path: epath, fullPath, params, queryFields, bodyFields, fileFields, hasAuth });
    }
  });
  return out;
}

function generateSpecFile() {
  const spec = buildOpenApiSpec({ title: projectTitle(), endpoints: collectEndpoints(), models: collectModels() });
  fs.writeFileSync(path.join(process.cwd(), 'src', 'openapi.json'), JSON.stringify(spec, null, 2), 'utf8');
  return spec;
}

// Keep the API docs in sync automatically: whenever routes or models change, the
// spec is regenerated — but only if docs have been set up. Writing openapi.json is
// a .json write, so it doesn't trigger a nodemon restart.
function refreshDocsSpec() {
  try {
    if (fs.existsSync(path.join(process.cwd(), 'src', 'docs.js'))) generateSpecFile();
  } catch {}
}

const docsAuthFile = () => path.join(process.cwd(), 'src', 'docs-auth.json');

// GET /api/docs — setup status + endpoint count + whether docs are password-protected
router.get('/api/docs', (req, res) => {
  try {
    const configured = fs.existsSync(path.join(process.cwd(), 'src', 'docs.js'));
    res.json({ configured, endpointCount: collectEndpoints().length, passwordProtected: fs.existsSync(docsAuthFile()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/docs/setup — create the docs route, generate the spec, wire index.js
router.post('/api/docs/setup', (req, res) => {
  try {
    // Writing src/docs.js and index.js triggers a nodemon restart (it watches .js
    // files). Respond FIRST so the restart can't drop this request, THEN write.
    res.json({ message: 'API docs set up at /docs.', endpointCount: collectEndpoints().length });
    fs.writeFileSync(path.join(process.cwd(), 'src', 'docs.js'), buildDocsRouter(), 'utf8');
    generateSpecFile();
    addImportToIndex("import docsRouter from './src/docs.js';");
    const reg = "app.use('/docs', docsRouter);";
    if (!readIndexFile().includes(reg)) insertBeforeListen(reg);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/docs/regenerate — rebuild the spec + refresh the docs page
router.post('/api/docs/regenerate', (req, res) => {
  try {
    const docsPath = path.join(process.cwd(), 'src', 'docs.js');
    if (!fs.existsSync(docsPath)) {
      return res.status(400).json({ error: 'Set up API docs first.' });
    }
    res.json({ message: 'API spec regenerated.', endpointCount: collectEndpoints().length });
    generateSpecFile();
    fs.writeFileSync(docsPath, buildDocsRouter(), 'utf8');
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/docs/password — protect /docs with a password (single password, no username)
router.post('/api/docs/password', (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    // Salted scrypt (not unsalted sha256) + a per-file secret used to sign the docs
    // session cookie, so the stored hash is never handed to the client.
    const salt = crypto.randomBytes(16);
    const hash = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(password, salt, 32).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.join(process.cwd(), 'src'), { recursive: true });
    fs.writeFileSync(docsAuthFile(), JSON.stringify({ hash, secret }, null, 2) + '\n', 'utf8');
    const docsPath = path.join(process.cwd(), 'src', 'docs.js');
    const needsUpgrade = fs.existsSync(docsPath) && !fs.readFileSync(docsPath, 'utf8').includes('docs_auth');
    res.json({
      message: needsUpgrade
        ? 'Docs password set — updating the docs route (server will restart).'
        : 'Docs are now password-protected.',
    });
    if (needsUpgrade) fs.writeFileSync(docsPath, buildDocsRouter(), 'utf8');
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// DELETE /api/docs/password — remove protection (docs become open again)
router.delete('/api/docs/password', (req, res) => {
  try {
    if (fs.existsSync(docsAuthFile())) fs.unlinkSync(docsAuthFile());
    res.json({ message: 'Docs password removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-api
// ---------------------------------------------------------------------------
router.post('/api/add-api', async (req, res) => {
  try {
    const { name, pathPrefix = '/api/', routeType, methods = [], modelName, loginField, passwordField, registerFields = [], selectedFields = [], customFields = [], authRequired = false } = req.body;
    // Legacy support: single method field
    const method = req.body.method;

    const safeName = sanitizeName(name);
    const camelName = toCamelCase(safeName);
    const pascalModel = modelName ? toPascalCase(modelName) : '';
    const type = routeType || (method ? 'methods' : 'plain');
    const methodList = method ? [method] : methods;
    const hasPassword = !!passwordField;

    const routesDir = path.join(process.cwd(), 'src', 'routes');
    if (!fs.existsSync(routesDir)) {
      fs.mkdirSync(routesDir, { recursive: true });
    }

    const routeFilePath = path.join(routesDir, safeName + '.js');

    // Install packages if needed
    const packagesToInstall = [];
    if (type === 'login' || type === 'register') {
      if (hasPassword) packagesToInstall.push('bcrypt');
      packagesToInstall.push('jsonwebtoken');
    }
    const allFieldsCombined = [...selectedFields.map(f => typeof f === 'string' ? { name: f, type: 'String' } : f), ...customFields];
    const needsMulter = allFieldsCombined.some(f => f.type === 'File');
    if (needsMulter) packagesToInstall.push('multer');
    if (authRequired && type !== 'login' && type !== 'register') packagesToInstall.push('jsonwebtoken');
    if (packagesToInstall.length > 0) {
      recordDeps(packagesToInstall);
      await execAsync(`npm install ${packagesToInstall.join(' ')}`, { cwd: process.cwd() });
    }

    // Build imports
    let imports = "import express from 'express';\n";
    if ((type === 'login' || type === 'register') && hasPassword) {
      imports += "import bcrypt from 'bcrypt';\n";
    }
    if (type === 'login' || type === 'register') {
      imports += "import jwt from 'jsonwebtoken';\n";
    }
    if ((type === 'login' || type === 'register' || type === 'crud') && modelName) {
      imports += `import ${pascalModel} from '../models/${modelName}.js';\n`;
    } else if (type === 'methods' && modelName && selectedFields.length > 0) {
      imports += `import ${pascalModel} from '../models/${modelName}.js';\n`;
    }

    // Build handlers
    let handlers = '';
    const findField = loginField || 'email';

    if (type === 'plain') {
      handlers += `
// Add your route handlers here
// Example: router.get('/', (req, res) => res.json({ message: '${safeName} works' }));
`;
    } else if (type === 'methods') {
      // Combine selected model fields + custom fields
      const allFields = [...selectedFields.map(f => typeof f === 'string' ? { name: f, type: 'String' } : f), ...customFields];
      const hasFileFields = allFields.some(f => f.type === 'File');
      const isMultipart = hasFileFields;
      const bodyFields = allFields.filter(f => f.type !== 'File');
      const fileFields = allFields.filter(f => f.type === 'File');

      if (isMultipart) {
        imports += "import multer from 'multer';\n";
      }

      methodList.forEach(m => {
        const dataSource = (m === 'get' || m === 'delete') ? 'req.query' : 'req.body';
        let middlewareStr = '';
        let destructLines = '';

        if (isMultipart && m !== 'get' && m !== 'delete') {
          if (fileFields.length === 0) {
            middlewareStr = 'upload.none(), ';
          } else if (fileFields.length === 1) {
            middlewareStr = `upload.single('${fileFields[0].name}'), `;
          } else {
            const fieldsArg = fileFields.map(f => `{ name: '${f.name}', maxCount: 1 }`).join(', ');
            middlewareStr = `upload.fields([${fieldsArg}]), `;
          }
        }

        if (bodyFields.length > 0) {
          const fieldNames = bodyFields.map(f => f.name).join(', ');
          destructLines += `  const { ${fieldNames} } = ${dataSource};\n`;
        }
        if (fileFields.length > 0 && m !== 'get' && m !== 'delete') {
          if (fileFields.length === 1) {
            destructLines += `  const ${fileFields[0].name} = req.file;\n`;
          } else {
            fileFields.forEach(f => {
              destructLines += `  const ${f.name} = req.files?.['${f.name}']?.[0];\n`;
            });
          }
        }

        if (allFields.length > 0) {
          handlers += `
router.${m}('/', ${middlewareStr}async (req, res) => {
${destructLines}
  // TODO: Add your logic here

  res.json({ msg: '${safeName} ${m.toUpperCase()} endpoint works' });
});
`;
        } else {
          handlers += `
router.${m}('/', async (req, res) => {
  res.json({ msg: '${safeName} ${m.toUpperCase()} endpoint works' });
});
`;
        }
      });

      if (isMultipart) {
        // Add multer setup after router declaration
        handlers = `\nconst upload = multer({ dest: 'uploads/' });\n` + handlers;
      }
    } else if (type === 'crud' && modelName) {
      const crudMethods = methodList.length > 0 ? methodList : ['get', 'post', 'put', 'delete'];
      const allFields = [...selectedFields.map(f => typeof f === 'string' ? { name: f, type: 'String' } : f), ...customFields];
      const bodyFields = allFields.filter(f => f.type !== 'File');
      const fileFields = allFields.filter(f => f.type === 'File');
      const hasFileFields = fileFields.length > 0;
      const hasFields = allFields.length > 0;

      if (hasFileFields) {
        imports += "import multer from 'multer';\n";
      }

      // Build destructure and object construction
      let destructure = '';
      let buildObj = 'req.body';
      if (hasFields) {
        const parts = [];
        if (bodyFields.length > 0) {
          destructure = `const { ${bodyFields.map(f => f.name).join(', ')} } = req.body;`;
          parts.push(...bodyFields.map(f => f.name));
        }
        if (fileFields.length > 0) {
          const fileLines = fileFields.map(f => {
            if (fileFields.length === 1) return `const ${f.name} = req.file ? req.file.path : undefined;`;
            return `const ${f.name} = req.files?.['${f.name}']?.[0]?.path || undefined;`;
          }).join('\n    ');
          destructure = (destructure ? destructure + '\n    ' : '') + fileLines;
          parts.push(...fileFields.map(f => f.name));
        }
        buildObj = `{ ${parts.join(', ')} }`;
      }

      // Multer middleware string for write methods
      let middlewareStr = '';
      if (hasFileFields) {
        if (fileFields.length === 1) {
          middlewareStr = `upload.single('${fileFields[0].name}'), `;
        } else {
          const fieldsArg = fileFields.map(f => `{ name: '${f.name}', maxCount: 1 }`).join(', ');
          middlewareStr = `upload.fields([${fieldsArg}]), `;
        }
      }

      if (crudMethods.includes('get')) {
        handlers += `
// Get all
router.get('/', async (req, res) => {
  try {
    const items = await ${pascalModel}.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get by ID
router.get('/:id', async (req, res) => {
  try {
    const item = await ${pascalModel}.findById(req.params.id);
    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
`;
      }

      if (crudMethods.includes('post')) {
        handlers += `
// Create
router.post('/', ${middlewareStr}async (req, res) => {
  try {
    ${destructure}
    const item = new ${pascalModel}(${buildObj});
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
`;
      }

      if (crudMethods.includes('put')) {
        handlers += `
// Update
router.put('/:id', ${middlewareStr}async (req, res) => {
  try {
    ${destructure}
    const item = await ${pascalModel}.findByIdAndUpdate(req.params.id, ${buildObj}, { returnDocument: 'after', runValidators: true });
    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
`;
      }

      if (crudMethods.includes('patch')) {
        handlers += `
// Partial Update
router.patch('/:id', ${middlewareStr}async (req, res) => {
  try {
    ${destructure}
    const item = await ${pascalModel}.findByIdAndUpdate(req.params.id, ${buildObj}, { returnDocument: 'after', runValidators: true });
    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
`;
      }

      if (crudMethods.includes('delete')) {
        handlers += `
// Delete
router.delete('/:id', async (req, res) => {
  try {
    const item = await ${pascalModel}.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: '${pascalModel} not found' });
    res.json({ message: '${pascalModel} deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
`;
      }

      if (hasFileFields) {
        handlers = `\nconst upload = multer({ dest: 'uploads/' });\n` + handlers;
      }
    } else if (type === 'register' && modelName) {
      const regFields = registerFields.length > 0 ? registerFields : [findField];
      const allDestructured = regFields.join(', ');
      const pwFieldName = hasPassword ? passwordField : null;
      const nonPwFields = regFields.filter(f => f !== pwFieldName);

      if (hasPassword) {
        const assignFields = nonPwFields.map(f => f).join(', ');
        handlers += `
// Register
router.post('/', async (req, res) => {
  try {
    const { ${allDestructured} } = req.body;
    const existing = await ${pascalModel}.findOne({ ${findField} });
    if (existing) return res.status(400).json({ message: '${pascalModel} already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(${pwFieldName}, salt);
    const item = new ${pascalModel}({ ${assignFields}, ${pwFieldName}: hashedPassword });
    const saved = await item.save();

    const token = jwt.sign({ id: saved._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, ${modelName}: { id: saved._id, ${findField}: saved.${findField} } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
`;
      } else {
        handlers += `
// Register
router.post('/', async (req, res) => {
  try {
    const { ${allDestructured} } = req.body;
    const existing = await ${pascalModel}.findOne({ ${findField} });
    if (existing) return res.status(400).json({ message: '${pascalModel} already exists' });

    const item = new ${pascalModel}({ ${allDestructured} });
    const saved = await item.save();

    const token = jwt.sign({ id: saved._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, ${modelName}: { id: saved._id, ${findField}: saved.${findField} } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
`;
      }
    } else if (type === 'login' && modelName) {
      if (hasPassword) {
        handlers += `
// Login
router.post('/', async (req, res) => {
  try {
    const { ${findField}, ${passwordField} } = req.body;
    const ${modelName} = await ${pascalModel}.findOne({ ${findField} });
    if (!${modelName}) return res.status(404).json({ message: '${pascalModel} not found' });

    const isMatch = await bcrypt.compare(${passwordField}, ${modelName}.${passwordField});
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: ${modelName}._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, ${modelName}: { id: ${modelName}._id, ${findField}: ${modelName}.${findField} } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
`;
      } else {
        handlers += `
// Login
router.post('/', async (req, res) => {
  try {
    const { ${findField} } = req.body;
    const ${modelName} = await ${pascalModel}.findOne({ ${findField} });
    if (!${modelName}) return res.status(404).json({ message: '${pascalModel} not found' });

    const token = jwt.sign({ id: ${modelName}._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, ${modelName}: { id: ${modelName}._id, ${findField}: ${modelName}.${findField} } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
`;
      }
    }

    let content = `${imports}
const router = express.Router();
${handlers}
export default router;
`;

    // Per-route validation: generate a Zod schema from the fields THIS route
    // accepts (not the whole model — one model is used by many routes, each with a
    // different subset of fields). Named after the route (e.g. login → loginSchema),
    // it's wired into the route's write endpoints. File fields are skipped (they're
    // not in req.body). Types come from the model where known.
    const validatorFields = routeValidatorFields(type, {
      findField, passwordField, hasPassword, registerFields, allFieldsCombined, modelName,
    });
    if (validatorFields && validatorFields.length) {
      const validatorsDir = path.join(process.cwd(), 'src', 'validators');
      fs.mkdirSync(validatorsDir, { recursive: true });
      fs.writeFileSync(path.join(validatorsDir, safeName + '.js'), buildZodSchemaFile(safeName, validatorFields), 'utf8');
      content = wireValidateIntoRouteContent(content, safeName);
    }

    // Require JWT auth on this route: ensure the auth middleware + JWT_SECRET exist,
    // then protect every endpoint. Login/register are exempt (they issue tokens).
    if (authRequired && type !== 'login' && type !== 'register') {
      const authPath = path.join(process.cwd(), 'src', 'middleware', 'auth.js');
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(path.dirname(authPath), { recursive: true });
        fs.writeFileSync(authPath, buildAuthMiddleware(), 'utf8');
      }
      const envFile = path.join(process.cwd(), '.env');
      if (!getEnvValue(envFile, 'JWT_SECRET')) {
        updateEnvFile(envFile, 'JWT_SECRET', crypto.randomBytes(32).toString('hex'));
      }
      content = wireAuthIntoRouteContent(content);
    }

    fs.writeFileSync(routeFilePath, content, 'utf8');

    const label = type === 'methods' ? methodList.map(m => m.toUpperCase()).join(', ') : type === 'crud' ? 'CRUD (' + (methodList.length > 0 ? methodList.map(m => m.toUpperCase()).join(', ') : 'ALL') + ')' : type === 'plain' ? 'PLAIN' : type.toUpperCase();

    // Ensure JWT_SECRET exists in env files for login/register routes
    if (type === 'login' || type === 'register') {
      const envFile = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes('JWT_SECRET')) {
        updateEnvFile(envFile, 'JWT_SECRET', crypto.randomBytes(32).toString('hex'));
      }
    }

    // Send response BEFORE modifying index.js (nodemon restart kills connection)
    res.json({
      message: `Route "${safeName}" created with ${label} endpoints.`,
      file: `src/routes/${safeName}.js`
    });

    // Build clean path: ensure prefix ends with / and no double slashes
    let prefix = pathPrefix || '/api/';
    if (!prefix.endsWith('/')) prefix += '/';
    const fullPath = (prefix + safeName).replace(/\/+/g, '/');

    // Update index.js (triggers nodemon restart)
    const importLine = `import ${camelName}Router from './src/routes/${safeName}.js';`;
    addImportToIndex(importLine);

    const routeRegistration = `app.use('${fullPath}', ${camelName}Router);`;
    let indexContent = readIndexFile();
    if (!indexContent.includes(routeRegistration)) {
      insertBeforeListen(routeRegistration);
    }
    refreshDocsSpec();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-mongo
// ---------------------------------------------------------------------------
router.post('/api/add-mongo', async (req, res) => {
  try {
    const uri = (req.body.uri || '').trim();
    const alreadyConfigured = checkMongoConfig();

    if (!uri) {
      return res.status(400).json({ error: 'MongoDB URI is required' });
    }

    updateEnvFile(path.join(process.cwd(), '.env'), 'MONGO_URI', uri);

    if (alreadyConfigured) {
      // Edit mode — just update .env, no need to reinstall or modify index.js
      res.json({
        message: 'MongoDB connection updated. Restart the server to apply changes.',
        files: ['.env']
      });
      return;
    }

    // First-time setup: install mongoose, create db.js, modify index.js
    recordDeps(['mongoose']);
    await execAsync('npm install mongoose', { cwd: process.cwd() });

    const dbDir = path.join(process.cwd(), 'src');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbContent = `import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(\`MongoDB connected: \${conn.connection.host}\`);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    console.error('Check your MONGO_URI in .env and ensure MongoDB is running.');
  }
};

export default connectDB;
`;
    fs.writeFileSync(path.join(dbDir, 'db.js'), dbContent, 'utf8');

    // Send response BEFORE modifying index.js (nodemon restart kills connection)
    res.json({
      message: 'MongoDB setup complete.',
      files: ['src/db.js', '.env', 'index.js']
    });

    // Modify index.js LAST (triggers nodemon restart)
    addImportToIndex("import connectDB from './src/db.js';");
    let indexContent = readIndexFile();
    if (!indexContent.includes('connectDB()')) {
      const appExpress = "const app = express();";
      const idx = indexContent.indexOf(appExpress);
      if (idx !== -1) {
        indexContent = indexContent.slice(0, idx) + 'connectDB();\n' + indexContent.slice(idx);
        writeIndexFile(indexContent);
      }
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-login
// ---------------------------------------------------------------------------
router.post('/api/add-login', async (req, res) => {
  try {
    const { routeFile, modelName, fields, tokenExpiry } = req.body;
    const pascalModel = toPascalCase(modelName);
    const hasPassword = fields.includes('password');

    // Install packages FIRST before modifying files
    const packages = hasPassword ? 'jsonwebtoken bcrypt' : 'jsonwebtoken';
    recordDeps(String(packages).split(/\s+/).filter(Boolean));
    await execAsync(`npm install ${packages}`, { cwd: process.cwd() });

    // Create src/middleware/auth.js if it doesn't exist
    const middlewareDir = path.join(process.cwd(), 'src', 'middleware');
    const authFilePath = path.join(middlewareDir, 'auth.js');
    if (!fs.existsSync(authFilePath)) {
      if (!fs.existsSync(middlewareDir)) {
        fs.mkdirSync(middlewareDir, { recursive: true });
      }
      const authContent = `import jwt from 'jsonwebtoken';

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

export default auth;
`;
      fs.writeFileSync(authFilePath, authContent, 'utf8');
    }

    // Build login endpoint code
    const fieldsDestructure = fields.join(', ');

    let passwordCheck = '';
    if (hasPassword) {
      passwordCheck = `
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }`;
    }

    let tokenCode = '';
    if (tokenExpiry) {
      tokenCode = `    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, refreshToken });`;
    } else {
      tokenCode = `    const token = jwt.sign(payload, process.env.JWT_SECRET);
    res.json({ token });`;
    }

    const loginCode = `
router.post('/login', async (req, res) => {
  const { ${fieldsDestructure} } = req.body;
  try {
    const user = await ${pascalModel}.findOne({ ${fields[0]}: ${fields[0]} });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }${passwordCheck}
    const payload = { id: user._id };
${tokenCode}
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});
`;

    // Add login endpoint to the selected route file
    const routeFilePath = path.join(process.cwd(), 'src', 'routes', routeFile);
    if (!fs.existsSync(routeFilePath)) {
      return res.status(404).json({ error: `Route file "${routeFile}" not found.` });
    }

    // Add imports to route file
    addImportToRoute(routeFilePath, "import jwt from 'jsonwebtoken';");
    if (hasPassword) {
      addImportToRoute(routeFilePath, "import bcrypt from 'bcrypt';");
    }
    addImportToRoute(routeFilePath, `import ${pascalModel} from '../models/${modelName}.js';`);

    // Insert login code
    insertCodeIntoRoute(routeFilePath, loginCode);

    // If tokenExpiry, create refresh-token route
    if (tokenExpiry) {
      const refreshRouteDir = path.join(process.cwd(), 'src', 'routes');
      const refreshFilePath = path.join(refreshRouteDir, 'refresh-token.js');
      if (!fs.existsSync(refreshFilePath)) {
        const refreshContent = `import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

router.post('/', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token required' });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const payload = { id: decoded.id };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ token });
  } catch (err) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

export default router;
`;
        fs.writeFileSync(refreshFilePath, refreshContent, 'utf8');

        // Register in index.js
        addImportToIndex("import refreshTokenRouter from './src/routes/refresh-token.js';");
        const routeReg = "app.use('/api/refresh-token', refreshTokenRouter);";
        let idxContent = readIndexFile();
        if (!idxContent.includes(routeReg)) {
          insertBeforeListen(routeReg);
        }
      }
    }

    // Generate JWT secret and update .env
    updateEnvFile(path.join(process.cwd(), '.env'), 'JWT_SECRET', crypto.randomBytes(32).toString('hex'));

    const filesModified = ['src/middleware/auth.js', `src/routes/${routeFile}`, '.env'];
    if (tokenExpiry) filesModified.push('src/routes/refresh-token.js');

    // Send response BEFORE index.js modifications (nodemon restart kills connection)
    res.json({
      message: 'JWT authentication setup complete.',
      files: filesModified
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-socket — create src/services/socket.js
// ---------------------------------------------------------------------------
router.post('/api/add-socket', async (req, res) => {
  try {
    const { corsOrigins } = req.body;

    // Install packages first
    const currentContent = readIndexFile();
    const hasWebSocket = currentContent.includes('setupWebSocket') || currentContent.includes('WebSocketServer');

    recordDeps(['socket.io']);
    if (hasWebSocket) {
      try { await execAsync('npm uninstall ws && npm install socket.io', { cwd: process.cwd() }); } catch {
        try { await execAsync('npm install socket.io', { cwd: process.cwd() }); } catch {}
      }
    } else {
      await execAsync('npm install socket.io', { cwd: process.cwd() });
    }

    // Send response before modifying files
    res.json({ message: 'Socket.IO setup complete.', files: ['src/services/socket.js', 'index.js'] });

    // Build cors origin value
    let originValue;
    if (corsOrigins === '*') originValue = '"*"';
    else originValue = JSON.stringify(corsOrigins.split(',').map(s => s.trim()));

    // Create src/services/socket.js
    const servicesDir = path.join(process.cwd(), 'src', 'services');
    if (!fs.existsSync(servicesDir)) fs.mkdirSync(servicesDir, { recursive: true });

    const socketFile = `import { Server } from "socket.io";
import http from "http";

export function setupSocketIO(app) {
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: ${originValue},
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("A user connected");
    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  // Make io accessible in routes via req.io
  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  return { server, io };
}
`;

    fs.writeFileSync(path.join(servicesDir, 'socket.js'), socketFile, 'utf8');

    // Remove old WebSocket service file if present
    const wsFile = path.join(servicesDir, 'websocket.js');
    if (fs.existsSync(wsFile)) fs.unlinkSync(wsFile);

    // Update index.js — clean approach
    let content = readIndexFile();

    // Remove old inline socket.io/websocket code
    content = content.replace(/import\s*\{\s*Server\s*\}\s*from\s*["']socket\.io["'];\s*\n?/g, '');
    content = content.replace(/import\s*\{\s*WebSocketServer\s*\}\s*from\s*['"]ws['"];\s*\n?/g, '');
    content = content.replace(/import\s+http\s+from\s*["']http["'];\s*\n?/g, '');
    content = content.replace(/const\s+server\s*=\s*http\.createServer\(app\);\s*\n?/g, '');
    content = content.replace(/const\s+io\s*=\s*new\s+Server\(server[\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/io\.on\(["']connection["'][\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/app\.use\(\(req,\s*res,\s*next\)\s*=>\s*\{\s*\n?\s*req\.io\s*=\s*io;\s*\n?\s*next\(\);\s*\n?\s*\}\);\s*\n?/g, '');
    content = content.replace(/const\s+wss\s*=\s*new\s+WebSocketServer\(\{[\s\S]*?\n?\}\);\s*\n?/g, '');
    content = content.replace(/wss\.on\(['"]connection['"][\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/console\.log\(['"]WebSocket server running on port.*?['"]?\);\s*\n?/g, '');
    // Remove old import lines for services
    content = content.replace(/import\s*\{\s*setupSocketIO\s*\}\s*from\s*['"]\.\/src\/services\/socket\.js['"];\s*\n?/g, '');
    content = content.replace(/import\s*\{\s*setupWebSocket\s*\}\s*from\s*['"]\.\/src\/services\/websocket\.js['"];\s*\n?/g, '');
    content = content.replace(/const\s*\{\s*server[^}]*\}\s*=\s*setupSocketIO\(app\);\s*\n?/g, '');
    content = content.replace(/const\s*\{\s*server[^}]*\}\s*=\s*setupWebSocket\(app\);\s*\n?/g, '');
    content = content.replace(/setupWebSocket\(app[^)]*\);\s*\n?/g, '');

    // Add import for socket service
    const lastImport = content.lastIndexOf('import ');
    const lineEnd = content.indexOf('\n', lastImport);
    content = content.slice(0, lineEnd + 1) + 'import { setupSocketIO } from "./src/services/socket.js";\n' + content.slice(lineEnd + 1);

    // Add setup call before listen
    const listenIdx = content.search(/\/\/ ── Start Server|async function startServer|function startServer/);
    if (listenIdx !== -1) {
      content = content.slice(0, listenIdx) + 'const { server } = setupSocketIO(app);\n\n' + content.slice(listenIdx);
    }

    // Replace app.listen with server.listen in startServer
    content = content.replace('const listener = app.listen(tryPort)', 'const listener = server.listen(tryPort)');
    // Also handle direct app.listen
    if (content.includes('app.listen(port') && !content.includes('startServer')) {
      content = content.replace(/app\.listen\(port[\s\S]*?\}\);?\n?/m, 'server.listen(port, () => {\n  console.log(`Server is running on port ${port}`);\n});\n');
    }

    // Revert server.listen back to app.listen for old-style
    content = content.replace('server.listen(port', 'server.listen(port');

    content = content.replace(/\n{3,}/g, '\n\n');
    writeIndexFile(content);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-websocket — create src/services/websocket.js
// ---------------------------------------------------------------------------
router.post('/api/add-websocket', async (req, res) => {
  try {
    const { samePort, wsPort } = req.body;

    // Install packages first
    const currentContent = readIndexFile();
    const hasSocketIO = currentContent.includes('setupSocketIO') || currentContent.includes('socket.io');

    recordDeps(['ws']);
    if (hasSocketIO) {
      try { await execAsync('npm uninstall socket.io && npm install ws', { cwd: process.cwd() }); } catch {
        try { await execAsync('npm install ws', { cwd: process.cwd() }); } catch {}
      }
    } else {
      await execAsync('npm install ws', { cwd: process.cwd() });
    }

    // Send response before modifying files
    res.json({ message: 'WebSocket setup complete.', files: ['src/services/websocket.js', 'index.js'] });

    // Create src/services/websocket.js
    const servicesDir = path.join(process.cwd(), 'src', 'services');
    if (!fs.existsSync(servicesDir)) fs.mkdirSync(servicesDir, { recursive: true });

    let wsFileContent;
    if (samePort) {
      wsFileContent = `import { WebSocketServer } from "ws";
import http from "http";

export function setupWebSocket(app) {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");
    ws.on("message", (message) => {
      console.log("Received:", message.toString());
    });
    ws.on("close", () => {
      console.log("WebSocket client disconnected");
    });
  });

  return { server, wss };
}
`;
    } else {
      const p = wsPort || 8080;
      wsFileContent = `import { WebSocketServer } from "ws";

export function setupWebSocket() {
  const wss = new WebSocketServer({ port: ${p} });

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");
    ws.on("message", (message) => {
      console.log("Received:", message.toString());
    });
    ws.on("close", () => {
      console.log("WebSocket client disconnected");
    });
  });

  console.log("WebSocket server running on port ${p}");
  return { wss };
}
`;
    }

    fs.writeFileSync(path.join(servicesDir, 'websocket.js'), wsFileContent, 'utf8');

    // Remove old Socket.IO service file if present
    const sioFile = path.join(servicesDir, 'socket.js');
    if (fs.existsSync(sioFile)) fs.unlinkSync(sioFile);

    // Update index.js — clean approach
    let content = readIndexFile();

    // Remove old inline socket.io/websocket code
    content = content.replace(/import\s*\{\s*Server\s*\}\s*from\s*["']socket\.io["'];\s*\n?/g, '');
    content = content.replace(/import\s*\{\s*WebSocketServer\s*\}\s*from\s*['"]ws['"];\s*\n?/g, '');
    content = content.replace(/import\s+http\s+from\s*["']http["'];\s*\n?/g, '');
    content = content.replace(/const\s+server\s*=\s*http\.createServer\(app\);\s*\n?/g, '');
    content = content.replace(/const\s+io\s*=\s*new\s+Server\(server[\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/io\.on\(["']connection["'][\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/app\.use\(\(req,\s*res,\s*next\)\s*=>\s*\{\s*\n?\s*req\.io\s*=\s*io;\s*\n?\s*next\(\);\s*\n?\s*\}\);\s*\n?/g, '');
    content = content.replace(/const\s+wss\s*=\s*new\s+WebSocketServer\(\{[\s\S]*?\n?\}\);\s*\n?/g, '');
    content = content.replace(/wss\.on\(['"]connection['"][\s\S]*?\n\}\);\s*\n?/g, '');
    content = content.replace(/console\.log\(['"]WebSocket server running on port.*?['"]?\);\s*\n?/g, '');
    // Remove old service imports
    content = content.replace(/import\s*\{\s*setupSocketIO\s*\}\s*from\s*['"]\.\/src\/services\/socket\.js['"];\s*\n?/g, '');
    content = content.replace(/import\s*\{\s*setupWebSocket\s*\}\s*from\s*['"]\.\/src\/services\/websocket\.js['"];\s*\n?/g, '');
    content = content.replace(/const\s*\{\s*server[^}]*\}\s*=\s*setupSocketIO\(app\);\s*\n?/g, '');
    content = content.replace(/const\s*\{\s*server[^}]*\}\s*=\s*setupWebSocket\(app\);\s*\n?/g, '');
    content = content.replace(/setupWebSocket\(app[^)]*\);\s*\n?/g, '');
    content = content.replace(/setupWebSocket\(\);\s*\n?/g, '');

    // Add import for websocket service
    const lastImport = content.lastIndexOf('import ');
    const lineEnd = content.indexOf('\n', lastImport);
    content = content.slice(0, lineEnd + 1) + 'import { setupWebSocket } from "./src/services/websocket.js";\n' + content.slice(lineEnd + 1);

    // Add setup call before listen
    const listenIdx = content.search(/\/\/ ── Start Server|async function startServer|function startServer/);
    if (listenIdx !== -1) {
      if (samePort) {
        content = content.slice(0, listenIdx) + 'const { server } = setupWebSocket(app);\n\n' + content.slice(listenIdx);
        // Replace app.listen with server.listen
        content = content.replace('const listener = app.listen(tryPort)', 'const listener = server.listen(tryPort)');
        if (content.includes('app.listen(port') && !content.includes('startServer')) {
          content = content.replace(/app\.listen\(port[\s\S]*?\}\);?\n?/m, 'server.listen(port, () => {\n  console.log(`Server is running on port ${port}`);\n});\n');
        }
      } else {
        content = content.slice(0, listenIdx) + 'setupWebSocket();\n\n' + content.slice(listenIdx);
      }
    }

    content = content.replace(/\n{3,}/g, '\n\n');
    writeIndexFile(content);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/serialports — list configured serial ports from index.js
// ---------------------------------------------------------------------------
router.get('/api/serialports', (req, res) => {
  try {
    const indexPath = path.join(process.cwd(), 'index.js');
    if (!fs.existsSync(indexPath)) return res.json([]);
    const content = fs.readFileSync(indexPath, 'utf8');
    const ports = [];
    // Match: const varName = new SerialPort({ path: '...', baudRate: 9600 })
    const regex = /const\s+(\w+)\s*=\s*new\s+SerialPort\(\{\s*\n?\s*path:\s*(?:process\.env\.\w+\s*\|\|\s*)?['"]([^'"]+)['"]\s*,\s*\n?\s*baudRate:\s*(?:parseInt\(process\.env\.\w+\)\s*\|\|\s*)?(\d+)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      ports.push({ name: m[1], path: m[2], baudRate: parseInt(m[3]) });
    }
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/add-serialport — add a named serial port connection
// ---------------------------------------------------------------------------
router.post('/api/add-serialport', async (req, res) => {
  try {
    const name = (req.body.name || 'serialPort').replace(/[^a-zA-Z0-9_]/g, '');
    const portPath = req.body.portPath || '/dev/ttyUSB0';
    const baud = req.body.baudRate || 9600;
    const parserName = name + 'Parser';
    const envPathKey = name.toUpperCase() + '_PATH';
    const envBaudKey = name.toUpperCase() + '_BAUD';

    // Install FIRST before modifying index.js
    const indexContent = readIndexFile();
    if (!indexContent.includes("from 'serialport'")) {
      recordDeps(['serialport', '@serialport/parser-readline']);
      await execAsync('npm install serialport @serialport/parser-readline', { cwd: process.cwd() });
    }

    // Update .env
    const envFile = path.join(process.cwd(), '.env');
    updateEnvFile(envFile, envPathKey, portPath);
    updateEnvFile(envFile, envBaudKey, String(baud));

    // Send response BEFORE modifying index.js
    res.json({
      message: 'Serial port "' + name + '" added.',
      files: ['index.js', '.env']
    });

    // Modify index.js LAST
    addImportToIndex("import { SerialPort } from 'serialport';");
    addImportToIndex("import { ReadlineParser } from '@serialport/parser-readline';");

    const serialCode = `const ${name} = new SerialPort({
  path: process.env.${envPathKey} || '${portPath}',
  baudRate: parseInt(process.env.${envBaudKey}) || ${baud}
});

const ${parserName} = ${name}.pipe(new ReadlineParser({ delimiter: '\\r\\n' }));

${name}.on('open', () => {
  console.log('${name}: port opened');
});

${parserName}.on('data', (data) => {
  console.log('${name} data:', data);
});

${name}.on('error', (err) => {
  console.error('${name} error:', err.message);
});`;

    let current = readIndexFile();
    if (!current.includes(`const ${name} = new SerialPort`)) {
      insertBeforeListen(serialCode);
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/serialports/:name — remove a serial port from index.js
// ---------------------------------------------------------------------------
router.delete('/api/serialports/:name', (req, res) => {
  try {
    // Strip to an identifier so the value can't inject regex metacharacters into
    // the index.js cleanup patterns below.
    const name = String(req.params.name || '').replace(/[^a-zA-Z0-9_]/g, '');
    const parserName = name + 'Parser';
    let content = readIndexFile();

    // Remove the SerialPort block: const name = new SerialPort({...});
    content = content.replace(new RegExp(`const\\s+${name}\\s*=\\s*new\\s+SerialPort\\(\\{[\\s\\S]*?\\}\\);\\s*\\n?`, 'g'), '');
    // Remove parser line
    content = content.replace(new RegExp(`const\\s+${parserName}\\s*=\\s*${name}\\.pipe[\\s\\S]*?;\\s*\\n?`, 'g'), '');
    // Remove event handlers
    content = content.replace(new RegExp(`${name}\\.on\\(['"]open['"][\\s\\S]*?\\}\\);\\s*\\n?`, 'g'), '');
    content = content.replace(new RegExp(`${parserName}\\.on\\(['"]data['"][\\s\\S]*?\\}\\);\\s*\\n?`, 'g'), '');
    content = content.replace(new RegExp(`${name}\\.on\\(['"]error['"][\\s\\S]*?\\}\\);\\s*\\n?`, 'g'), '');

    // If no more SerialPort instances, remove imports
    if (!content.includes('new SerialPort')) {
      content = content.replace(/import\s*\{\s*SerialPort\s*\}\s*from\s*['"]serialport['"];\s*\n?/g, '');
      content = content.replace(/import\s*\{\s*ReadlineParser\s*\}\s*from\s*['"]@serialport\/parser-readline['"];\s*\n?/g, '');
    }

    // Clean up multiple blank lines
    content = content.replace(/\n{3,}/g, '\n\n');
    writeIndexFile(content);

    // Remove env vars
    const envPathKey = name.toUpperCase() + '_PATH';
    const envBaudKey = name.toUpperCase() + '_BAUD';
    const envFilePath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envFilePath)) {
      let envContent = fs.readFileSync(envFilePath, 'utf8');
      envContent = envContent.replace(new RegExp(`^${envPathKey}=.*\\n?`, 'm'), '');
      envContent = envContent.replace(new RegExp(`^${envBaudKey}=.*\\n?`, 'm'), '');
      fs.writeFileSync(envFilePath, envContent, 'utf8');
    }

    res.json({ message: 'Serial port "' + name + '" removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API Tester — field configs (stored in .4bnode/tester-fields.json)
// ---------------------------------------------------------------------------
const testerFieldsPath = path.join(process.cwd(), '.4bnode', 'tester-fields.json');

function loadTesterFields() {
  try {
    if (fs.existsSync(testerFieldsPath)) return JSON.parse(fs.readFileSync(testerFieldsPath, 'utf8'));
  } catch {}
  return {};
}

function saveTesterFields(data) {
  const dir = path.dirname(testerFieldsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(testerFieldsPath, JSON.stringify(data, null, 2), 'utf8');
}

const testerDataPath = path.join(process.cwd(), '.4bnode', 'tester-data.json');

function loadTesterData() {
  try {
    if (fs.existsSync(testerDataPath)) return JSON.parse(fs.readFileSync(testerDataPath, 'utf8'));
  } catch {}
  return { tests: [], responses: {} };
}

function saveTesterData(data) {
  const dir = path.dirname(testerDataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(testerDataPath, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/api-tester/data — load saved tests and responses
router.get('/api/api-tester/data', (req, res) => {
  res.json(loadTesterData());
});

// PUT /api/api-tester/data — save tests and responses
router.put('/api/api-tester/data', (req, res) => {
  const { tests, responses } = req.body;
  saveTesterData({ tests: tests || [], responses: responses || {} });
  res.json({ message: 'Saved' });
});

// GET /api/api-tester/fields/:routeKey — get saved fields for a route
router.get('/api/api-tester/fields/:routeKey', (req, res) => {
  const all = loadTesterFields();
  const key = decodeURIComponent(req.params.routeKey);
  res.json({ fields: all[key] || null });
});

// PUT /api/api-tester/fields/:routeKey — save fields for a route
router.put('/api/api-tester/fields/:routeKey', (req, res) => {
  const { fields } = req.body;
  const key = decodeURIComponent(req.params.routeKey);
  const all = loadTesterFields();
  all[key] = fields;
  saveTesterFields(all);
  res.json({ message: 'Fields saved' });
});

// ---------------------------------------------------------------------------
// API Tester — proxy requests to avoid CORS issues
// ---------------------------------------------------------------------------
router.post('/api/api-tester/send', async (req, res) => {
  try {
    const { method, url, headers: reqHeaders, body: reqBody, bodyType = 'json', formFields = [] } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const blocked = blockedFetchTarget(url);
    if (blocked) return res.status(400).json({ error: blocked });

    const fetchOpts = { method: (method || 'GET').toUpperCase() };
    const headers = { ...(reqHeaders || {}) };

    if (['POST', 'PUT', 'PATCH'].includes(fetchOpts.method)) {
      if (bodyType === 'form-data' && formFields.length > 0) {
        // Build multipart form data
        const boundary = '----4bnode' + crypto.randomBytes(8).toString('hex');
        let bodyParts = [];
        for (const field of formFields) {
          if (!field.key?.trim()) continue;
          if (field.fileData) {
            // File field (base64 encoded data)
            const fileBuffer = Buffer.from(field.fileData, 'base64');
            bodyParts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"; filename="${field.fileName || 'file'}"\r\nContent-Type: ${field.fileType || 'application/octet-stream'}\r\n\r\n`
            );
            bodyParts.push(fileBuffer);
            bodyParts.push('\r\n');
          } else {
            bodyParts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value || ''}\r\n`
            );
          }
        }
        bodyParts.push(`--${boundary}--\r\n`);
        // Combine string and buffer parts
        const bufferParts = bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
        fetchOpts.body = Buffer.concat(bufferParts);
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      } else if (bodyType === 'x-www-form-urlencoded' && formFields.length > 0) {
        fetchOpts.body = formFields
          .filter(f => f.key?.trim())
          .map(f => encodeURIComponent(f.key) + '=' + encodeURIComponent(f.value || ''))
          .join('&');
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (bodyType === 'binary' && reqBody) {
        // Binary body (base64 encoded)
        fetchOpts.body = Buffer.from(reqBody, 'base64');
      } else if (reqBody) {
        fetchOpts.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody);
      }
    }

    // Remove Content-Type for form-data (let boundary be set correctly)
    if (bodyType === 'form-data') {
      // Already set above with boundary
    }

    fetchOpts.headers = headers;

    const start = Date.now();
    const response = await fetch(url, fetchOpts);
    const elapsed = Date.now() - start;
    const text = await response.text();
    const respHeaders = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: text,
      time: elapsed,
      size: Buffer.byteLength(text),
    });
  } catch (err) {
    res.json({ status: 0, statusText: 'Connection Error', body: err.message, headers: {}, time: 0, size: 0 });
  }
});

// GET /api/api-tester/routes — list all routes with endpoints for import
router.get('/api/api-tester/routes', (req, res) => {
  try {
    const routes = listRoutes();
    const result = [];
    const indexPath = path.join(process.cwd(), 'index.js');
    const indexContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';

    routes.forEach(routeFile => {
      const name = routeFile.replace('.js', '');
      const filePath = path.join(process.cwd(), 'src', 'routes', routeFile);
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf8');

      let prefix = '/api/' + name;
      const prefixMatch = indexContent.match(new RegExp(`app\\.use\\(['"](\\/[^'"]+)['"].*${name}`));
      if (prefixMatch) prefix = prefixMatch[1];

      const modelImportMatch = content.match(/import\s+(\w+)\s+from\s+['"]\.\.\/models\/(\w+)['"]/);
      let modelFields = [];
      if (modelImportMatch) {
        modelFields = getModelSchemaDetailed(modelImportMatch[2]).fields;
      }

      const endpoints = [];
      const epRegex = /router\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*?)['"`]\s*,([\s\S]*?)(?=\nrouter\.|$)/gi;
      let m;
      while ((m = epRegex.exec(content)) !== null) {
        const method = m[1].toUpperCase();
        const epath = m[2];
        const body = m[3] || '';
        const bodyFields = [];
        const queryFields = [];
        const fileFields = [];
        extractRequestFields(body, 'body').forEach(fname => {
          const meta = modelFields.find(mf => mf.name === fname);
          bodyFields.push({ name: fname, type: meta?.type || 'String', required: meta?.required || false, unique: meta?.unique || false });
        });
        extractRequestFields(body, 'query').forEach(fname => {
          queryFields.push({ name: fname, type: 'String' });
        });
        // Detect file fields from multer middleware and req.file/req.files
        const uploadSingleMatch = body.match(/upload\.single\(\s*['"](\w+)['"]\s*\)/);
        if (uploadSingleMatch) fileFields.push({ name: uploadSingleMatch[1] });
        const uploadFieldsRegex = /name:\s*['"](\w+)['"]/g;
        const uploadFieldsBlock = body.match(/upload\.fields\(\s*\[([\s\S]*?)\]\s*\)/);
        if (uploadFieldsBlock) {
          let ufm;
          while ((ufm = uploadFieldsRegex.exec(uploadFieldsBlock[1])) !== null) {
            if (!fileFields.find(f => f.name === ufm[1])) fileFields.push({ name: ufm[1] });
          }
        }
        // Also detect from req.file / req.files assignments
        const singleFileMatch = body.match(/const\s+(\w+)\s*=\s*req\.file\b/);
        if (singleFileMatch && !fileFields.find(f => f.name === singleFileMatch[1])) fileFields.push({ name: singleFileMatch[1] });
        const multiFileRegex = /const\s+(\w+)\s*=\s*req\.files\??\[?\s*\[?['"]([\w]+)['"]\]?/g;
        let fm;
        while ((fm = multiFileRegex.exec(body)) !== null) {
          if (!fileFields.find(f => f.name === fm[1])) fileFields.push({ name: fm[1] });
        }

        const hasAuth = /auth\s*,/.test(m[0]);
        const params = [];
        const paramRegex = /:(\w+)/g;
        let pm;
        while ((pm = paramRegex.exec(epath)) !== null) params.push(pm[1]);

        endpoints.push({
          method,
          path: epath,
          fullPath: prefix + (epath === '/' ? '' : epath),
          bodyFields,
          queryFields,
          fileFields,
          params,
          hasAuth,
        });
      }
      const hasAuth = content.includes("import auth");
      result.push({ name, routeFile, prefix, endpoints, hasAuth });
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Logs — history, SSE stream, clear
// ---------------------------------------------------------------------------
router.get('/api/logs', (req, res) => {
  res.json(_logBuffer);
});

router.get('/api/logs/stream', (req, res) => {
  // Prefer the x-passkey header (the dashboard streams via fetch, not EventSource,
  // so the passkey never lands in a URL/access log). Query param kept only as a
  // legacy fallback for older clients.
  const stored = getPasskeyHash();
  if (stored) {
    const lock = authLockState(req);
    if (lock.locked) {
      res.set('Retry-After', String(lock.retryAfter));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const pk = req.headers['x-passkey'] || req.query.passkey;
    if (!verifyPasskey(pk, stored)) {
      if (pk) recordAuthFailure(req);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n');
  _logClients.add(res);
  req.on('close', () => _logClients.delete(res));
});

router.delete('/api/logs', (req, res) => {
  _logBuffer.length = 0;
  res.json({ message: 'Logs cleared' });
});

// ---------------------------------------------------------------------------
// Share Collection — save and serve standalone shared page
// ---------------------------------------------------------------------------
const sharedDir = path.join(process.cwd(), '.4bnode', 'shared');

router.post('/api/api-tester/share-collection', (req, res) => {
  try {
    const { tests, responses } = req.body;
    if (!tests?.length) return res.status(400).json({ error: 'No tests to share' });
    if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });
    let appName = 'API Collection';
    try { appName = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).name || appName; } catch {}
    // Use fixed ID so the share URL stays the same — always updates the same file
    const id = crypto.createHash('md5').update(appName).digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(sharedDir, id + '.json'), JSON.stringify({ tests, responses, appName, createdAt: new Date().toISOString() }));
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shared/:id', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    // Share ids are 12 hex chars (md5 slice). Reject anything else so the id can't
    // traverse out of sharedDir (e.g. ../../config).
    if (!/^[a-f0-9]{12}$/.test(req.params.id)) return res.status(404).send('Collection not found');
    const filePath = path.join(sharedDir, req.params.id + '.json');
    if (!fs.existsSync(filePath)) return res.status(404).send('Collection not found');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.tests) data.tests = [];
    if (!data.responses) data.responses = {};
    const rawAppName = data.appName || 'My App';
    // Convert kebab-case/snake_case to Title Case: "test-app" → "Test App"
    const appName = rawAppName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const safeJson = (obj) => JSON.stringify(obj).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
    const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const safeAppName = escHtml(appName);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeAppName} - API Documentation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column}
.topbar{height:52px;background:#161b26;border-bottom:1px solid #1e2433;display:flex;align-items:center;padding:0 24px;gap:12px;flex-shrink:0}
.topbar-name{font-size:16px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.topbar-sep{width:1px;height:22px;background:#1e2433;margin:0 8px}
.topbar-label{font-size:12px;color:#64748b;font-weight:500}
.topbar-count{font-size:10px;padding:3px 10px;border-radius:10px;background:rgba(124,58,237,0.15);color:#a78bfa;font-weight:600;margin-left:auto}
.topbar-date{font-size:10px;color:#475569}
.layout{display:flex;flex:1;overflow:hidden}
.sidebar{width:300px;min-width:300px;background:#161b26;border-right:1px solid #1e2433;display:flex;flex-direction:column;overflow:hidden}
.sidebar-header{padding:14px 18px;border-bottom:1px solid #1e2433;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#475569;display:flex;justify-content:space-between;align-items:center}
.sidebar-search{padding:8px 12px;border-bottom:1px solid #1e2433}
.sidebar-search input{width:100%;padding:7px 12px;background:#0f1117;border:1px solid #1e2433;border-radius:6px;color:#e2e8f0;font-size:12px;outline:none}
.sidebar-search input:focus{border-color:#7c3aed}
.sidebar-search input::placeholder{color:#475569}
.sidebar-list{flex:1;overflow-y:auto}
.sidebar-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(30,36,51,0.5);display:flex;align-items:center;gap:10px;transition:all 0.12s;border-left:3px solid transparent;color:#e2e8f0}
.sidebar-item:hover{background:rgba(124,58,237,0.06)}
.sidebar-item.active{background:rgba(124,58,237,0.1);border-left-color:#7c3aed}
.sidebar-child{padding:8px 14px 8px 48px;cursor:pointer;border-bottom:1px solid rgba(30,36,51,0.3);display:flex;align-items:center;gap:8px;transition:all 0.12s;border-left:3px solid transparent}
.sidebar-child:hover{background:rgba(124,58,237,0.06)}
.sidebar-child.active{background:rgba(124,58,237,0.1);border-left-color:#7c3aed}
.mb{font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;font-family:'SF Mono','Fira Code',monospace;text-transform:uppercase;flex-shrink:0;letter-spacing:0.3px}
.mb-get{background:rgba(52,211,153,0.15);color:#34d399}
.mb-post{background:rgba(245,158,11,0.15);color:#f59e0b}
.mb-put{background:rgba(59,130,246,0.15);color:#3b82f6}
.mb-patch{background:rgba(139,92,246,0.15);color:#8b5cf6}
.mb-delete{background:rgba(248,113,113,0.15);color:#f87171}
.item-name{font-size:12px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0}
.item-arrow{font-size:10px;color:#475569;width:14px;text-align:center;flex-shrink:0}
.item-badge{font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(124,58,237,0.15);color:#a78bfa;font-weight:600}
.sb{font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;font-family:'SF Mono','Fira Code',monospace;flex-shrink:0}
.s2{background:rgba(52,211,153,0.15);color:#34d399}
.s3{background:rgba(96,165,250,0.15);color:#60a5fa}
.s4{background:rgba(251,191,36,0.15);color:#fbbf24}
.s5{background:rgba(248,113,113,0.15);color:#f87171}
.s0{background:rgba(248,113,113,0.15);color:#f87171}
.child-label{font-size:11px;color:#94a3b8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.child-time{font-size:10px;color:#475569;flex-shrink:0}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.main-content{flex:1;overflow-y:auto;padding:24px}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#475569;gap:12px}
.empty-state svg{width:48px;height:48px;stroke:#2d3548;stroke-width:1.5;fill:none}
.card{background:#161b26;border:1px solid #1e2433;border-radius:10px;padding:18px;margin-bottom:16px}
.card-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #1e2433}
.endpoint-url{font-family:'SF Mono','Fira Code',monospace;font-size:13px;color:#e2e8f0;background:#0f1117;padding:10px 14px;border-radius:8px;border:1px solid #1e2433;margin-bottom:16px;display:flex;align-items:center;gap:10px;justify-content:space-between}
.endpoint-url code{flex:1;word-break:break-all}
.copy-btn{padding:5px 12px;border:1px solid #1e2433;border-radius:6px;background:#0f1117;color:#94a3b8;font-size:11px;cursor:pointer;font-family:inherit;transition:all 0.15s;white-space:nowrap}
.copy-btn:hover{border-color:#7c3aed;color:#a78bfa}
.stitle{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#475569;margin-bottom:10px}
pre{font-family:'SF Mono','Fira Code',monospace;font-size:12px;line-height:1.7;color:#94a3b8;white-space:pre-wrap;word-break:break-word;background:#0f1117;padding:14px;border-radius:8px;border:1px solid #1e2433;position:relative}
.field-row{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f1117;border-radius:6px;margin-bottom:4px;border:1px solid #1e2433}
.field-name{font-family:'SF Mono','Fira Code',monospace;font-size:12px;font-weight:500;color:#e2e8f0;min-width:120px}
.field-type{font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(124,58,237,0.12);color:#a78bfa;font-weight:500}
.field-req{font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(52,211,153,0.12);color:#34d399;font-weight:600}
.field-uniq{font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(251,191,36,0.12);color:#fbbf24;font-weight:600}
.code-tabs{display:flex;gap:0;border-bottom:1px solid #1e2433;margin-bottom:0}
.code-tab{padding:7px 16px;font-size:11px;font-weight:500;color:#475569;background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;transition:all 0.15s}
.code-tab:hover{color:#94a3b8}
.code-tab.active{color:#a78bfa;border-bottom-color:#7c3aed;font-weight:600}
.header-row{display:flex;padding:6px 12px;font-size:12px;gap:12px;border-bottom:1px solid rgba(30,36,51,0.5)}
.header-key{font-family:'SF Mono','Fira Code',monospace;font-size:11px;font-weight:600;color:#a78bfa;min-width:160px}
.header-val{font-family:'SF Mono','Fira Code',monospace;font-size:11px;color:#94a3b8;word-break:break-all}
.type-sio{background:rgba(52,211,153,0.15);color:#34d399}
.type-ws{background:rgba(96,165,250,0.15);color:#60a5fa}
.dir-recv{background:rgba(52,211,153,0.15);color:#34d399}
.dir-sent{background:rgba(245,158,11,0.15);color:#f59e0b}
.dir-sys{background:rgba(148,163,184,0.15);color:#94a3b8}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:16px;height:16px;border:2px solid #1e2433;border-top-color:#7c3aed;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block}
</style></head><body>
<div class="topbar">
  <span class="topbar-name">${safeAppName}</span>
  <span class="topbar-sep"></span>
  <span class="topbar-label">API Documentation</span>
  <span class="topbar-count">${data.tests.length} endpoint${data.tests.length !== 1 ? 's' : ''}</span>
  <span class="topbar-date">Shared ${new Date(data.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
</div>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header"><span>Endpoints</span></div>
    <div class="sidebar-search"><input id="search-inp" placeholder="Search endpoints..." /></div>
    <div class="sidebar-list" id="sidebar-list"></div>
  </div>
  <div class="main">
    <div class="main-content" id="main-content">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span style="font-size:14px;font-weight:500">Select an endpoint from the sidebar</span>
        <span style="font-size:12px">View request details, example code, and saved responses</span>
      </div>
    </div>
  </div>
</div>
<script id="shared-data" type="application/json">${safeJson({ tests: data.tests, responses: data.responses || {} })}</script>
<script>
(function(){
  var _d = JSON.parse(document.getElementById('shared-data').textContent);
  var tests = _d.tests;
  var responses = _d.responses;
  var activeTestId = null;
  var activeRespId = null;
  var expanded = {};
  var activeCodeTab = {};
  var searchQuery = '';

  tests.forEach(function(t){ t.id = String(t.id); });
  var normResp = {};
  Object.keys(responses).forEach(function(k){
    var key = String(k);
    var arr = responses[k];
    if (Array.isArray(arr)) arr.forEach(function(r){ r.id = String(r.id); });
    normResp[key] = arr;
  });
  responses = normResp;

  function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Copy via event delegation
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var target = btn.getAttribute('data-copy');
    var text = '';
    if (target === 'prev-pre') {
      var pre = btn.closest('div').querySelector('pre');
      if (pre) text = pre.textContent;
    } else if (target === 'url') {
      var code = btn.closest('.endpoint-url');
      if (code) text = code.querySelector('code').textContent;
    }
    if (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = '#34d399';
      setTimeout(function(){ btn.textContent = orig; btn.style.color = ''; }, 1500);
    }
  });

  // Generate code snippets
  var _isForm = function(t) { return (t.bodyType === 'form-data' || t.bodyType === 'x-www-form-urlencoded') && t.formFields && t.formFields.length > 0; };
  var _hasBody = function(t) { return ['POST','PUT','PATCH'].indexOf(t.method) !== -1; };

  function genCurl(t) {
    var nl = String.fromCharCode(10);
    var bs = String.fromCharCode(92);
    var c = 'curl -X ' + t.method + " '" + t.url + "'";
    if (_isForm(t)) {
      t.formFields.forEach(function(f) {
        if (!f.key) return;
        if (f.type === 'file') {
          c += ' ' + bs + nl + "  -F '" + f.key + "=@/path/to/" + (f.fileName || 'file') + "'";
        } else {
          c += ' ' + bs + nl + "  -F '" + f.key + '=' + (f.value || '') + "'";
        }
      });
    } else {
      if (t.headers) t.headers.forEach(function(h) { if (h.key) c += ' ' + bs + nl + "  -H '" + h.key + ': ' + (h.value||'') + "'"; });
      if (t.body && _hasBody(t)) {
        c += ' ' + bs + nl + "  -d '" + t.body.replace(/'/g, "'") + "'";
      }
    }
    return c;
  }
  function genFetch(t) {
    var nl = String.fromCharCode(10);
    var lines = [];
    if (_isForm(t)) {
      lines.push('const formData = new FormData();');
      t.formFields.forEach(function(f) {
        if (!f.key) return;
        if (f.type === 'file') {
          lines.push("formData.append('" + f.key + "', fileInput.files[0]); // " + (f.fileName || 'file'));
        } else {
          lines.push("formData.append('" + f.key + "', '" + (f.value || '') + "');");
        }
      });
      lines.push('');
      lines.push("fetch('" + t.url + "', {");
      lines.push("  method: '" + t.method + "',");
      lines.push('  body: formData,');
      lines.push('})');
    } else {
      lines.push("fetch('" + t.url + "', {");
      lines.push("  method: '" + t.method + "',");
      var hdrs = {};
      if (t.headers) t.headers.forEach(function(h) { if (h.key) hdrs[h.key] = h.value || ''; });
      if (Object.keys(hdrs).length > 0) lines.push('  headers: ' + JSON.stringify(hdrs, null, 4) + ',');
      if (t.body && _hasBody(t)) {
        var formatted = t.body;
        try { formatted = JSON.stringify(JSON.parse(t.body)); } catch(e) {}
        lines.push('  body: JSON.stringify(' + formatted + '),');
      }
      lines.push('})');
    }
    lines.push('.then(res => res.json())');
    lines.push('.then(data => console.log(data))');
    lines.push('.catch(err => console.error(err));');
    return lines.join(nl);
  }
  function genAxios(t) {
    var nl = String.fromCharCode(10);
    var m = t.method.toLowerCase();
    var hdrs = {};
    if (t.headers) t.headers.forEach(function(h) { if (h.key) hdrs[h.key] = h.value || ''; });
    var lines = [];
    if (_isForm(t)) {
      lines.push('const formData = new FormData();');
      t.formFields.forEach(function(f) {
        if (!f.key) return;
        if (f.type === 'file') {
          lines.push("formData.append('" + f.key + "', fileInput.files[0]); // " + (f.fileName || 'file'));
        } else {
          lines.push("formData.append('" + f.key + "', '" + (f.value || '') + "');");
        }
      });
      lines.push('');
      lines.push("const { data } = await axios." + m + "('" + t.url + "', formData, {");
      lines.push("  headers: { 'Content-Type': 'multipart/form-data' },");
      lines.push('});');
    } else if (_hasBody(t) && t.body) {
      var d = t.body;
      try { d = JSON.stringify(JSON.parse(d), null, 2); } catch(e) {}
      lines.push('const { data } = await axios.' + m + '(');
      lines.push("  '" + t.url + "',");
      lines.push('  ' + d.split(nl).join(nl + '  '));
      if (Object.keys(hdrs).length > 0) lines.push('  , { headers: ' + JSON.stringify(hdrs) + ' }');
      lines.push(');');
    } else {
      lines.push("const { data } = await axios." + m + "('" + t.url + "'");
      if (Object.keys(hdrs).length > 0) lines.push('  , { headers: ' + JSON.stringify(hdrs) + ' }');
      lines.push(');');
    }
    lines.push('console.log(data);');
    return lines.join(nl);
  }

  function filteredTests() {
    if (!searchQuery) return tests;
    var q = searchQuery.toLowerCase();
    return tests.filter(function(t) {
      return (t.name||'').toLowerCase().includes(q) || (t.url||'').toLowerCase().includes(q) || (t.method||'').toLowerCase().includes(q);
    });
  }

  function renderSidebar() {
    var sb = document.getElementById('sidebar-list');
    var h = '';
    var ft = filteredTests();
    ft.forEach(function(t) {
      var resps = responses[t.id] || [];
      var isActive = activeTestId === t.id && !activeRespId;
      var isExp = expanded[t.id];
      var tt = t.type || 'rest';
      h += '<div class="sidebar-item' + (isActive ? ' active' : '') + '" data-test="' + t.id + '">';
      if (resps.length > 0) h += '<span class="item-arrow">' + (isExp ? '&#9660;' : '&#9654;') + '</span>';
      else h += '<span class="item-arrow"></span>';
      if (tt === 'socketio') h += '<span class="mb type-sio">SIO</span>';
      else if (tt === 'websocket') h += '<span class="mb type-ws">WS</span>';
      else h += '<span class="mb mb-' + (t.method||'GET').toLowerCase() + '">' + (t.method||'GET') + '</span>';
      h += '<span class="item-name">' + esc(t.name) + '</span>';
      if (resps.length > 0) h += '<span class="item-badge">' + resps.length + '</span>';
      h += '</div>';
      if (isExp && resps.length > 0) {
        resps.forEach(function(r) {
          var isRActive = activeRespId === r.id && activeTestId === t.id;
          var isSocket = r.dir;
          h += '<div class="sidebar-child' + (isRActive ? ' active' : '') + '" data-test="' + t.id + '" data-resp="' + r.id + '">';
          if (isSocket) {
            var dirCls = r.dir === 'received' ? 'dir-recv' : r.dir === 'sent' ? 'dir-sent' : 'dir-sys';
            h += '<span class="sb ' + dirCls + '">' + (r.dir === 'received' ? '&#8595;' : r.dir === 'sent' ? '&#8593;' : '&#9679;') + '</span>';
          } else {
            h += '<span class="sb s' + Math.floor(r.status/100) + '">' + r.status + '</span>';
          }
          h += '<span class="child-label">' + esc(r.label) + '</span>';
          if (!isSocket && r.time) h += '<span class="child-time">' + r.time + 'ms</span>';
          h += '</div>';
        });
      }
    });
    if (ft.length === 0) h = '<div style="padding:20px;text-align:center;color:#475569;font-size:12px">No endpoints found</div>';
    sb.innerHTML = h;
  }

  // Search
  document.getElementById('search-inp').addEventListener('input', function(e) {
    searchQuery = e.target.value;
    renderSidebar();
  });

  document.getElementById('sidebar-list').addEventListener('click', function(e) {
    var el = e.target.closest('.sidebar-item, .sidebar-child');
    if (!el) return;
    var testId = el.getAttribute('data-test');
    var respId = el.getAttribute('data-resp');
    if (respId) {
      activeTestId = testId; activeRespId = respId;
      renderSidebar(); renderRespView(testId, respId);
    } else {
      var wasActive = activeTestId === testId && !activeRespId;
      activeTestId = testId; activeRespId = null;
      var resps = responses[testId] || [];
      if (resps.length > 0) { if (wasActive) expanded[testId] = !expanded[testId]; else expanded[testId] = true; }
      renderSidebar(); renderTestView(testId);
    }
  });

  function renderTestView(id) {
    var t = tests.find(function(x){ return x.id === id; });
    if (!t) return;
    var tt = t.type || 'rest';
    var main = document.getElementById('main-content');

    if (tt === 'socketio' || tt === 'websocket') {
      var nl = String.fromCharCode(10);
      var resps = responses[id] || [];
      var sentLogs = resps.filter(function(r) { return r.dir === 'sent'; });
      var recvLogs = resps.filter(function(r) { return r.dir === 'received'; });
      var sysLogs = resps.filter(function(r) { return r.dir === 'system'; });

      var h = '<div class="card"><div class="card-header">';
      if (tt === 'socketio') h += '<span class="mb type-sio" style="font-size:11px;padding:4px 10px">Socket.IO</span>';
      else h += '<span class="mb type-ws" style="font-size:11px;padding:4px 10px">WebSocket</span>';
      h += '<span style="font-size:16px;font-weight:600">' + esc(t.name) + '</span></div>';

      h += '<div class="stitle">Connection URL</div>';
      h += '<div class="endpoint-url"><code>' + esc(t.url) + '</code><button class="copy-btn" data-copy="url">Copy</button></div>';
      h += '</div>';

      // ── Emit Events Section ──
      h += '<div class="card">';
      h += '<div class="card-header"><span style="font-size:14px;font-weight:600;color:#f59e0b">&#8593; Emit Events</span>';
      h += '<span style="font-size:10px;padding:3px 10px;border-radius:10px;background:rgba(245,158,11,0.12);color:#f59e0b;font-weight:600;margin-left:auto">Client &#8594; Server</span></div>';

      if (tt === 'socketio' && t.event) {
        h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
        h += '<span class="stitle" style="margin:0;min-width:70px">Event</span>';
        h += '<span style="font-size:13px;padding:6px 14px;border-radius:6px;background:rgba(245,158,11,0.1);color:#f59e0b;font-family:SF Mono,monospace;font-weight:600;border:1px solid rgba(245,158,11,0.2)">' + esc(t.event) + '</span>';
        h += '</div>';
      }
      if (tt === 'websocket' && t.message) {
        h += '<div class="stitle">Message</div>';
      }

      if (t.data || t.message) {
        h += '<div class="stitle" style="margin-bottom:6px">Payload</div>';
        var d = t.data || t.message || ''; try { d = JSON.stringify(JSON.parse(d), null, 2); } catch(e) {}
        h += '<div style="position:relative"><pre style="margin-bottom:14px">' + esc(d) + '</pre>';
        h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button></div>';
      }

      // Emit code example
      if (tt === 'socketio') {
        h += '<div class="stitle" style="margin-bottom:6px">Code</div>';
        var emitCode = "// Client-side emit" + nl;
        emitCode += "import { io } from 'socket.io-client';" + nl;
        emitCode += "const socket = io('" + t.url + "');" + nl + nl;
        if (t.event) {
          var ed = t.data || '{}'; try { ed = JSON.stringify(JSON.parse(ed), null, 2); } catch(e) {}
          emitCode += "socket.emit('" + t.event + "', " + ed + ");" + nl + nl;
        }
        emitCode += "// Server-side handler" + nl;
        emitCode += "io.on('connection', (socket) => {" + nl;
        if (t.event) {
          emitCode += "  socket.on('" + t.event + "', (data) => {" + nl;
          emitCode += "    console.log('" + t.event + ":', data);" + nl;
          emitCode += "  });" + nl;
        }
        emitCode += "});" + nl + nl;
        emitCode += "// Emit from Express route" + nl;
        if (t.event) {
          var ed2 = t.data || '{}'; try { ed2 = JSON.stringify(JSON.parse(ed2), null, 2); } catch(e) {}
          emitCode += "req.io.emit('" + t.event + "', " + ed2 + ");";
        } else {
          emitCode += "req.io.emit('event_name', { key: 'value' });";
        }
        h += '<div style="position:relative"><pre style="margin-bottom:14px">' + esc(emitCode) + '</pre>';
        h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button></div>';
      } else {
        h += '<div class="stitle" style="margin-bottom:6px">Code</div>';
        var wsSendCode = "const ws = new WebSocket('" + t.url + "');" + nl + nl;
        wsSendCode += "ws.onopen = () => {" + nl;
        if (t.message) {
          wsSendCode += "  ws.send(JSON.stringify(" + (t.message || "{}") + "));" + nl;
        } else {
          wsSendCode += "  ws.send(JSON.stringify({ key: 'value' }));" + nl;
        }
        wsSendCode += "};";
        h += '<div style="position:relative"><pre style="margin-bottom:14px">' + esc(wsSendCode) + '</pre>';
        h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button></div>';
      }

      // Saved emitted logs
      if (sentLogs.length > 0) {
        h += '<div class="stitle" style="margin-bottom:8px">Saved Emits (' + sentLogs.length + ')</div>';
        sentLogs.forEach(function(r) {
          var body = r.body || ''; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
          h += '<div style="background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:10px 14px;margin-bottom:6px">';
          h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (body ? '8px' : '0') + '">';
          h += '<span class="sb dir-sent" style="font-size:9px;padding:2px 6px">&#8593; EMIT</span>';
          h += '<span style="font-size:12px;font-weight:500">' + esc(r.label) + '</span>';
          h += '</div>';
          if (body) {
            h += '<div style="position:relative"><pre style="margin:0;font-size:11px">' + esc(body) + '</pre>';
            h += '<button class="copy-btn" style="position:absolute;top:4px;right:4px;font-size:10px;padding:2px 8px" data-copy="prev-pre">Copy</button></div>';
          }
          h += '</div>';
        });
      }
      h += '</div>';

      // ── Event Listeners Section ──
      h += '<div class="card">';
      h += '<div class="card-header"><span style="font-size:14px;font-weight:600;color:#34d399">&#8595; Event Listeners</span>';
      h += '<span style="font-size:10px;padding:3px 10px;border-radius:10px;background:rgba(52,211,153,0.12);color:#34d399;font-weight:600;margin-left:auto">Server &#8594; Client</span></div>';

      if (tt === 'socketio' && t.listeners && t.listeners.length > 0) {
        h += '<div class="stitle" style="margin-bottom:8px">Listening On</div>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">';
        t.listeners.forEach(function(l) {
          h += '<span style="font-size:12px;padding:6px 14px;border-radius:6px;background:rgba(52,211,153,0.1);color:#34d399;font-family:SF Mono,monospace;font-weight:600;border:1px solid rgba(52,211,153,0.2)">' + esc(l) + '</span>';
        });
        h += '</div>';

        // Listener code example
        h += '<div class="stitle" style="margin-bottom:6px">Code</div>';
        var listenCode = "// Client-side listeners" + nl;
        listenCode += "import { io } from 'socket.io-client';" + nl;
        listenCode += "const socket = io('" + t.url + "');" + nl;
        t.listeners.forEach(function(l) {
          listenCode += nl + "socket.on('" + l + "', (data) => {" + nl;
          listenCode += "  console.log('" + l + ":', data);" + nl;
          listenCode += "});" + nl;
        });
        listenCode += nl + "// Server-side broadcast" + nl;
        t.listeners.forEach(function(l) {
          listenCode += "io.emit('" + l + "', data);" + nl;
        });
        h += '<div style="position:relative"><pre style="margin-bottom:14px">' + esc(listenCode) + '</pre>';
        h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button></div>';
      } else if (tt === 'websocket') {
        h += '<div class="stitle" style="margin-bottom:6px">Code</div>';
        var wsRecvCode = "const ws = new WebSocket('" + t.url + "');" + nl + nl;
        wsRecvCode += "ws.onmessage = (event) => {" + nl;
        wsRecvCode += "  const data = JSON.parse(event.data);" + nl;
        wsRecvCode += "  console.log('Received:', data);" + nl;
        wsRecvCode += "};" + nl + nl;
        wsRecvCode += "ws.onclose = () => console.log('Disconnected');";
        h += '<div style="position:relative"><pre style="margin-bottom:14px">' + esc(wsRecvCode) + '</pre>';
        h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button></div>';
      } else {
        h += '<div style="font-size:12px;color:#475569;padding:8px 0">No listeners configured</div>';
      }

      // Saved received logs
      if (recvLogs.length > 0) {
        h += '<div class="stitle" style="margin-bottom:8px">Received Events (' + recvLogs.length + ')</div>';
        recvLogs.forEach(function(r) {
          var body = r.body || ''; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
          h += '<div style="background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:10px 14px;margin-bottom:6px">';
          h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (body ? '8px' : '0') + '">';
          h += '<span class="sb dir-recv" style="font-size:9px;padding:2px 6px">&#8595; RECV</span>';
          h += '<span style="font-size:12px;font-weight:500">' + esc(r.label) + '</span>';
          h += '</div>';
          if (body) {
            h += '<div style="position:relative"><pre style="margin:0;font-size:11px">' + esc(body) + '</pre>';
            h += '<button class="copy-btn" style="position:absolute;top:4px;right:4px;font-size:10px;padding:2px 8px" data-copy="prev-pre">Copy</button></div>';
          }
          h += '</div>';
        });
      }

      // System logs
      if (sysLogs.length > 0) {
        h += '<div class="stitle" style="margin-top:12px;margin-bottom:8px">System Events (' + sysLogs.length + ')</div>';
        sysLogs.forEach(function(r) {
          h += '<div style="background:#0f1117;border:1px solid #1e2433;border-radius:8px;padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:8px">';
          h += '<span class="sb dir-sys" style="font-size:9px;padding:2px 6px">&#9679; SYS</span>';
          h += '<span style="font-size:12px;color:#94a3b8">' + esc(r.label) + '</span>';
          h += '</div>';
        });
      }

      h += '</div>';
      main.innerHTML = h; return;
    }

    var mc = { GET:'#34d399', POST:'#f59e0b', PUT:'#3b82f6', PATCH:'#8b5cf6', DELETE:'#f87171' };
    var formatted = t.body || '';
    try { formatted = JSON.stringify(JSON.parse(formatted), null, 2); } catch(e) {}
    var hasBody = ['POST','PUT','PATCH'].indexOf(t.method) !== -1;
    var isFormData = t.bodyType === 'form-data' || t.bodyType === 'x-www-form-urlencoded';
    var hasFormFields = t.formFields && t.formFields.length > 0;
    var hasJsonBody = hasBody && t.body;
    var bodyFields = [];
    if (hasJsonBody && !isFormData) { try { var bo = JSON.parse(t.body); bodyFields = Object.keys(bo); } catch(e) {} }

    var h = '';
    // Header
    h += '<div class="card"><div class="card-header">';
    h += '<span class="mb mb-' + t.method.toLowerCase() + '" style="font-size:12px;padding:4px 10px">' + t.method + '</span>';
    h += '<span style="font-size:16px;font-weight:600">' + esc(t.name) + '</span>';
    if (isFormData) h += '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(245,158,11,0.12);color:#f59e0b;font-weight:600;margin-left:8px">' + (t.bodyType === 'form-data' ? 'multipart/form-data' : 'x-www-form-urlencoded') + '</span>';
    h += '</div>';

    // URL
    h += '<div class="endpoint-url"><code>' + esc(t.url) + '</code><button class="copy-btn" data-copy="url">Copy URL</button></div>';

    // Headers
    if (t.headers && t.headers.length > 0) {
      h += '<div class="stitle">Headers</div>';
      h += '<div style="background:#0f1117;border:1px solid #1e2433;border-radius:8px;margin-bottom:16px;overflow:hidden">';
      t.headers.forEach(function(hdr) {
        if (!hdr.key) return;
        h += '<div class="header-row"><span class="header-key">' + esc(hdr.key) + '</span><span class="header-val">' + esc(hdr.value||'') + '</span></div>';
      });
      h += '</div>';
    }

    // Form Data Fields
    if (hasFormFields) {
      h += '<div class="stitle">Request Fields <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#64748b">(' + (t.bodyType || 'form-data') + ')</span></div>';
      t.formFields.forEach(function(f) {
        if (!f.key) return;
        var isFile = f.type === 'file';
        h += '<div class="field-row">';
        h += '<span class="field-name">' + esc(f.key) + '</span>';
        if (isFile) {
          h += '<span class="field-type" style="background:rgba(245,158,11,0.12);color:#f59e0b">File</span>';
        } else {
          h += '<span class="field-type">Text</span>';
        }
        if (f.value && !isFile) h += '<span style="font-size:11px;color:#64748b;font-family:monospace;margin-left:auto">' + esc(f.value) + '</span>';
        h += '</div>';
      });
      h += '<div style="margin-top:12px"></div>';
    }

    // JSON Body Fields
    if (!isFormData && hasJsonBody && bodyFields.length > 0) {
      h += '<div class="stitle">Body Fields</div>';
      var bodyObj = JSON.parse(t.body);
      bodyFields.forEach(function(f) {
        var val = bodyObj[f];
        var type = typeof val === 'number' ? 'Number' : typeof val === 'boolean' ? 'Boolean' : 'String';
        h += '<div class="field-row"><span class="field-name">' + esc(f) + '</span><span class="field-type">' + type + '</span></div>';
      });
      h += '<div style="margin-top:12px"></div>';
    }

    // Request Body Example (JSON only)
    if (!isFormData && hasJsonBody) {
      h += '<div class="stitle">Request Body Example</div>';
      h += '<pre style="margin-bottom:16px">' + esc(formatted) + '</pre>';
    }

    // Code Snippets
    var codeTab = activeCodeTab[id] || 'curl';
    h += '<div class="stitle">Code Examples</div>';
    h += '<div style="background:#0f1117;border:1px solid #1e2433;border-radius:8px;overflow:hidden;margin-bottom:16px">';
    h += '<div class="code-tabs">';
    ['curl','fetch','axios'].forEach(function(tab) {
      h += '<button class="code-tab' + (codeTab === tab ? ' active' : '') + '" data-codetab="' + tab + '" data-testid="' + id + '">' + (tab === 'curl' ? 'cURL' : tab.charAt(0).toUpperCase() + tab.slice(1)) + '</button>';
    });
    h += '</div>';
    var code = codeTab === 'curl' ? genCurl(t) : codeTab === 'fetch' ? genFetch(t) : genAxios(t);
    h += '<div style="position:relative"><pre style="border:none;border-radius:0;margin:0">' + esc(code) + '</pre>';
    h += '<button class="copy-btn" style="position:absolute;top:8px;right:8px" data-copy="prev-pre">Copy</button>';
    h += '</div></div>';

    h += '</div>';

    // Saved Responses
    var resps = responses[id] || [];
    if (resps.length > 0) {
      h += '<div class="stitle" style="margin-top:8px">Saved Responses (' + resps.length + ')</div>';
      resps.forEach(function(r) {
        var sc = Math.floor(r.status/100);
        var body = r.body || ''; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
        h += '<div class="card" style="padding:0;overflow:hidden">';
        h += '<div style="padding:10px 16px;border-bottom:1px solid #1e2433;display:flex;align-items:center;gap:10px">';
        h += '<span class="sb s' + sc + '" style="font-size:11px;padding:3px 8px">' + r.status + ' ' + esc(r.statusText||'') + '</span>';
        h += '<span style="font-size:13px;font-weight:500">' + esc(r.label) + '</span>';
        if (r.time) h += '<span style="font-size:11px;color:#475569;margin-left:auto">' + r.time + 'ms</span>';
        h += '</div>';
        if (r.requestBody && r.requestBody.trim()) {
          var rb = r.requestBody; try { rb = JSON.stringify(JSON.parse(rb), null, 2); } catch(e) {}
          h += '<div style="padding:12px 16px;border-bottom:1px solid #1e2433"><div class="stitle" style="margin-bottom:6px">Request Body</div><pre style="margin:0">' + esc(rb) + '</pre></div>';
        }
        h += '<div style="padding:12px 16px"><div class="stitle" style="margin-bottom:6px">Response Body</div><pre style="margin:0">' + esc(body) + '</pre></div>';
        h += '</div>';
      });
    }

    main.innerHTML = h;
  }

  function renderRespView(testId, respId) {
    var resps = responses[testId] || [];
    var r = resps.find(function(x){ return x.id === respId; });
    if (!r) return;
    var main = document.getElementById('main-content');
    var t = tests.find(function(x){ return x.id === testId; });
    var isSocket = r.dir;

    var h = '<div class="card"><div class="card-header">';
    if (isSocket) {
      var dirCls = r.dir === 'received' ? 'dir-recv' : r.dir === 'sent' ? 'dir-sent' : 'dir-sys';
      h += '<span class="sb ' + dirCls + '" style="font-size:12px;padding:4px 10px">' + (r.dir === 'received' ? 'Received' : r.dir === 'sent' ? 'Sent' : 'System') + '</span>';
    } else {
      h += '<span class="sb s' + Math.floor(r.status/100) + '" style="font-size:12px;padding:4px 10px">' + r.status + ' ' + esc(r.statusText||'') + '</span>';
    }
    h += '<span style="font-size:16px;font-weight:600">' + esc(r.label) + '</span>';
    if (!isSocket && r.time) h += '<span style="font-size:11px;color:#475569;margin-left:auto">' + r.time + 'ms</span>';
    h += '</div>';

    if (t) { h += '<div class="endpoint-url" style="margin-bottom:16px"><code>' + esc(t.url) + '</code></div>'; }

    if (!isSocket && r.requestBody && r.requestBody.trim()) {
      var rb = r.requestBody; try { rb = JSON.stringify(JSON.parse(rb), null, 2); } catch(e) {}
      h += '<div class="stitle">Request Body</div><pre style="margin-bottom:16px">' + esc(rb) + '</pre>';
    }
    var body = r.body || ''; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(e) {}
    h += '<div class="stitle">' + (isSocket ? 'Data' : 'Response Body') + '</div><pre>' + esc(body) + '</pre>';
    h += '</div>';

    main.innerHTML = h;
  }

  // Code tab switching
  document.getElementById('main-content').addEventListener('click', function(e) {
    var tab = e.target.closest('[data-codetab]');
    if (tab) {
      var testId = tab.getAttribute('data-testid');
      activeCodeTab[testId] = tab.getAttribute('data-codetab');
      renderTestView(testId);
      return;
    }
  });

  try { renderSidebar(); } catch(e) { console.error('renderSidebar error:', e); }
  if (tests.length > 0) {
    activeTestId = tests[0].id;
    var firstResps = responses[tests[0].id] || [];
    if (firstResps.length > 0) expanded[tests[0].id] = true;
    try { renderSidebar(); } catch(e) { console.error('renderSidebar error:', e); }
    try { renderTestView(tests[0].id); } catch(e) { console.error('renderTestView error:', e); }
  }
})();
</script></body></html>`;

    res.type('html').send(html);
  } catch (err) {
    res.status(500).send('Error loading collection');
  }
});

export default router;
