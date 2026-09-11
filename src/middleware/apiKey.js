// API key authentication. Named keys are managed by the 4bnode dashboard and
// stored in src/api-keys.json. Send a key in the `x-api-key` request header:
//   import apiKey from './src/middleware/apiKey.js';
//   app.use('/api/private', apiKey);
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const KEYS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api-keys.json');
let _cache = { mtimeMs: -1, keys: [] };

// Read the keys file fresh when it changes (mtime-cached), so keys generated or
// revoked in the dashboard take effect immediately — no restart needed.
function loadKeys() {
  try {
    const { mtimeMs } = fs.statSync(KEYS_FILE);
    if (mtimeMs !== _cache.mtimeMs) {
      const list = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      _cache = { mtimeMs, keys: (Array.isArray(list) ? list : []).map((k) => k && k.key).filter(Boolean) };
    }
  } catch {
    _cache = { mtimeMs: -1, keys: [] };
  }
  return _cache.keys;
}

// Constant-time membership test: hash both sides to a fixed length so neither the
// match result nor the key length leaks through string-comparison timing.
function keyMatches(provided, valid) {
  const p = crypto.createHash('sha256').update(String(provided)).digest();
  let ok = false;
  for (const k of valid) {
    const h = crypto.createHash('sha256').update(String(k)).digest();
    if (crypto.timingSafeEqual(p, h)) ok = true; // no early return — keep timing flat
  }
  return ok;
}

const apiKey = (req, res, next) => {
  const provided = req.header('x-api-key');
  const valid = loadKeys();
  if (!provided || !keyMatches(provided, valid)) {
    return res.status(401).json({ message: 'Invalid or missing API key' });
  }
  next();
};

export default apiKey;
