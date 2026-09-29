import { createServer } from 'node:http';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = process.env.COLORTRACE_DATA_DIR ? resolve(process.env.COLORTRACE_DATA_DIR) : join(root, '..', '.colortrace-data');
const imageDir = join(dataDir, 'images');
const storePath = join(dataDir, 'records.json');
const keyPath = join(dataDir, 'demo-signing-key.pem');
const port = Number(process.env.PORT || 4173);
const maxImageBytes = 8 * 1024 * 1024;
const clients = new Set();
const now = () => new Date().toISOString();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

const seed = [
  { id: 'CT-2026-000184', result: 'INCONCLUSIVE', confidence: 71, officer: 'A. Sharma', station: 'NDPS Cell, Central', captured: '2026-09-28T10:12:44+05:30', kit: 'Demo Colorimetric Kit', kitId: 'DEMO-COLOR-001', profileVersion: '1.2.0', quality: 'Pass', calibration: 67, sync: 'Synced', location: { lat: 28.6139, lng: 77.209, accuracy: 8.2 }, model: 'demo-mobile-0.4.1', synthetic: true, audit: ['Capture sealed', 'Calibration completed', 'Decision marked inconclusive', 'Record signed'] },
  { id: 'CT-2026-000183', result: 'POSITIVE', confidence: 94, officer: 'N. Verma', station: 'NDPS Cell, Central', captured: '2026-09-28T09:48:18+05:30', kit: 'Demo Colorimetric Kit', kitId: 'DEMO-COLOR-001', profileVersion: '1.2.0', quality: 'Pass', calibration: 93, sync: 'Synced', location: { lat: 28.6315, lng: 77.2167, accuracy: 6 }, model: 'demo-mobile-0.4.1', synthetic: true, audit: ['Capture sealed', 'Reference card detected', 'Model inference completed', 'Record signed'] },
  { id: 'CT-2026-000182', result: 'NEGATIVE', confidence: 89, officer: 'P. Iyer', station: 'Special Branch, East', captured: '2026-09-28T09:21:07+05:30', kit: 'Demo Colorimetric Kit', kitId: 'DEMO-COLOR-001', profileVersion: '1.2.0', quality: 'Pass', calibration: 91, sync: 'Synced', location: { lat: 28.6098, lng: 77.227, accuracy: 9.4 }, model: 'demo-mobile-0.4.1', synthetic: true, audit: ['Capture sealed', 'Quality gate passed', 'Result signed', 'Server receipt issued'] },
  { id: 'CT-2026-000181', result: 'RETAKE REQUIRED', confidence: null, officer: 'A. Sharma', station: 'NDPS Cell, Central', captured: '2026-09-28T08:56:03+05:30', kit: 'Demo Colorimetric Kit', kitId: 'DEMO-COLOR-001', profileVersion: '1.2.0', quality: 'Fail', calibration: null, sync: 'Pending sync', location: { lat: 28.6172, lng: 77.2005, accuracy: 11 }, model: 'demo-mobile-0.4.1', synthetic: true, audit: ['Focus check failed', 'High glare detected', 'Stored in encrypted queue'] }
];

let records = [];
let privateKey;
let publicKey;
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const canonicalRecord = (record) => ({ test_id: record.id, operator_id: record.officer, organization: 'Narcotics Control / Central Region', kit_id: record.kitId, kit_profile_version: record.profileVersion, result: record.result, confidence: record.confidence, captured_at: record.captured, location: record.location, image_sha256: record.imageHash, model_version: record.model, calibration_quality: record.calibration, image_quality: record.quality, previous_audit_hash: record.previousAuditHash });

async function save() { await writeFile(storePath, JSON.stringify(records, null, 2)); }
function appendAudit(record, action) {
  const entry = { at: now(), action, previous_hash: record.auditHash || null, record_hash: record.recordHash };
  entry.hash = digest(canonical(entry));
  record.audit.push(entry);
  record.auditHash = entry.hash;
}
function seal(record, previousAuditHash = null) {
  record.previousAuditHash = previousAuditHash;
  record.recordHash = digest(canonical(canonicalRecord(record)));
  record.signature = sign(null, Buffer.from(record.recordHash, 'hex'), privateKey).toString('base64');
  record.keyId = digest(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
  record.audit = [];
  record.auditHash = null;
  appendAudit(record, 'Record sealed and signed');
}
function publicRecord(record) {
  return { id: record.id, result: record.result, confidence: record.confidence == null ? 'N/A' : `${record.confidence}%`, officer: record.officer, station: record.station, captured: new Date(record.captured).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }), capturedAt: record.captured, kit: record.kit, kitId: record.kitId, profileVersion: record.profileVersion, quality: record.quality, calibration: record.calibration == null ? 'N/A' : `${record.calibration}%`, sync: record.sync, integrity: record.synthetic ? 'Synthetic fixture' : record.sync === 'Pending sync' ? 'Awaiting sync' : 'Valid', location: record.location, locationText: record.location ? `${record.location.lat.toFixed(4)}, ${record.location.lng.toFixed(4)}` : 'Not captured', model: record.model, synthetic: record.synthetic, imageHash: record.imageHash, recordHash: record.recordHash, signature: record.signature, keyId: record.keyId, audit: record.audit.map((entry) => `${new Date(entry.at).toLocaleTimeString('en-IN', { hour12: false })} ${entry.action}`), auditHash: record.auditHash };
}
function publish(type, record, extra = {}) {
  const event = `data: ${JSON.stringify({ type, test_id: record.id, occurred_at: now(), result: record.result, sync: record.sync, ...extra })}\n\n`;
  for (const client of clients) client.write(event);
}
async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > maxImageBytes * 1.5) throw new Error('Request body too large'); }
  return JSON.parse(raw || '{}');
}
async function verifyRecord(record) {
  const expectedHash = digest(canonical(canonicalRecord(record)));
  const keyFor = (entry) => entry.devicePublicKey ? createPublicKey({ key: Buffer.from(entry.devicePublicKey, 'base64'), format: 'der', type: 'spki' }) : publicKey;
  let signatureOk = false;
  try { signatureOk = record.recordHash === expectedHash && verify(null, Buffer.from(record.recordHash, 'hex'), keyFor(record), Buffer.from(record.signature || '', 'base64')); } catch { signatureOk = false; }
  const linked = records.find((item) => item.id === record.id);
  const predecessor = linked?.previousAuditHash ? records.find((item) => item.recordHash === linked.previousAuditHash) : null;
  let predecessorSignature = false;
  try { predecessorSignature = Boolean(predecessor && predecessor.recordHash === digest(canonical(canonicalRecord(predecessor))) && verify(null, Buffer.from(predecessor.recordHash, 'hex'), keyFor(predecessor), Buffer.from(predecessor.signature || '', 'base64'))); } catch { predecessorSignature = false; }
  const predecessorValid = !linked?.previousAuditHash || predecessorSignature;
  let auditOk = linked?.audit?.length > 0 && predecessorValid;
  let prior = null;
  for (const entry of linked?.audit || []) {
    const { hash, ...content } = entry;
    if (entry.previous_hash !== prior || digest(canonical(content)) !== hash) auditOk = false;
    prior = hash;
  }
  if (prior !== linked?.auditHash) auditOk = false;
  let imageOk = false;
  if (!record.synthetic && record.imagePath) {
    try { imageOk = digest(await readFile(record.imagePath)) === record.imageHash; }
    catch { imageOk = false; }
  }
  return { image_hash: Boolean(imageOk), record_hash: record.recordHash === expectedHash, signature: Boolean(signatureOk), audit_chain: Boolean(auditOk), status: record.synthetic ? 'Synthetic fixture; original image unavailable' : imageOk && signatureOk && auditOk ? 'Valid' : 'Review required' };
}

async function initialize() {
  await mkdir(imageDir, { recursive: true });
  try { privateKey = createPrivateKey(await readFile(keyPath)); }
  catch {
    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' }).catch(async () => { privateKey = createPrivateKey(await readFile(keyPath)); });
  }
  publicKey = createPublicKey(privateKey);
  try { records = JSON.parse(await readFile(storePath, 'utf8')); }
  catch {
    records = seed.map((item) => {
      const record = { ...item, audit: [], imageHash: digest(`synthetic-demo-image:${item.id}`), originalImageHash: digest(`synthetic-demo-image:${item.id}`), imagePath: null, locationText: `${item.location.lat}, ${item.location.lng}` };
      return record;
    }).sort((a, b) => a.id.localeCompare(b.id));
    let previous = null;
    records.forEach((record) => { seal(record, previous); previous = record.recordHash; });
    records.sort((a, b) => b.id.localeCompare(a.id));
    await save();
  }
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/dashboard/summary') {
      const pending = records.filter((item) => item.sync === 'Pending sync').length;
      const review = records.filter((item) => item.result === 'INCONCLUSIVE' || item.result === 'RETAKE REQUIRED').length;
      const verification = await Promise.all(records.map(verifyRecord));
      return json(res, 200, { total: records.length, review, pending, integrity: Math.round(100 * verification.filter((item) => item.status === 'Valid').length / Math.max(1, records.length)), tests: records.map(publicRecord) });
    }
    if (req.method === 'GET' && url.pathname === '/api/tests') return json(res, 200, { tests: records.map(publicRecord) });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'connected', occurred_at: now() })}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/tests/sync') {
      const input = await bodyJson(req);
      const offline = input.record;
      if (!offline || !/^LOCAL-[a-f0-9]{12}$/.test(offline.id) || !input.imageData || !input.devicePublicKey) return json(res, 400, { detail: 'Offline record envelope is incomplete.' });
      if (records.some((item) => item.id === offline.id)) return json(res, 409, { detail: 'This offline record ID already exists.' });
      const fileMatch = String(input.imageData).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!fileMatch) return json(res, 415, { detail: 'Offline original image is missing or unsupported.' });
      const image = Buffer.from(fileMatch[2], 'base64');
      const imageHash = digest(image);
      if (!image.length || image.length > maxImageBytes || imageHash !== offline.imageHash) return json(res, 422, { detail: 'Offline image digest does not match the signed record.' });
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const rawPublic = Buffer.from(input.devicePublicKey, 'base64');
      if (rawPublic.length !== 32) return json(res, 422, { detail: 'Offline signing public key is invalid.' });
      const deviceKey = createPublicKey({ key: Buffer.concat([spkiPrefix, rawPublic]), format: 'der', type: 'spki' });
      const localAudit = Array.isArray(offline.audit) ? offline.audit : [];
      if (localAudit.length !== 1) return json(res, 422, { detail: 'Offline audit entry is missing or malformed.' });
      const { hash: localAuditHash, ...localAuditEvent } = localAudit[0];
      if (localAuditEvent.previous_hash !== null || localAuditEvent.record_hash !== offline.recordHash || digest(canonical(localAuditEvent)) !== localAuditHash || offline.auditHash !== localAuditHash) return json(res, 422, { detail: 'Offline audit digest is invalid.' });
      const { signature, recordHash, imageData: ignoredImage, devicePublicKey: ignoredKey, ...recordFields } = offline;
      const candidate = { ...recordFields, imageHash, signature, recordHash, previousAuditHash: offline.previousAuditHash || null };
      const expectedHash = digest(canonical(canonicalRecord(candidate)));
      const signed = recordHash === expectedHash && verify(null, Buffer.from(recordHash, 'hex'), deviceKey, Buffer.from(signature || '', 'base64'));
      if (!signed) return json(res, 422, { detail: 'Offline record signature or canonical digest is invalid.' });
      const imagePath = join(imageDir, `${offline.id}.${fileMatch[1]}`);
      await writeFile(imagePath, image, { flag: 'wx' });
      const record = { ...candidate, kit: 'Demo Colorimetric Kit', sync: 'Synced', synthetic: false, imagePath, originalImageHash: imageHash, devicePublicKey: deviceKey.export({ type: 'spki', format: 'der' }).toString('base64'), keyId: digest(deviceKey.export({ type: 'spki', format: 'der' })).slice(0, 16), audit: localAudit, auditHash: localAuditHash };
      appendAudit(record, 'Offline signed record verified and synchronized');
      records.unshift(record);
      await save();
      publish('test.synced', record);
      return json(res, 201, { test: publicRecord(record) });
    }
    const createMatch = req.method === 'POST' && url.pathname === '/api/tests';
    if (createMatch) {
      const input = await bodyJson(req);
      for (const field of ['officer', 'station', 'kitId', 'imageData']) if (!input[field]) return json(res, 400, { detail: `Missing required field: ${field}` });
      if (input.classification && !['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'].includes(input.classification)) return json(res, 400, { detail: 'Unsupported classification.' });
      if (input.quality && !['Pass', 'Fail'].includes(input.quality)) return json(res, 400, { detail: 'Unsupported image quality status.' });
      if (!String(input.officer).trim() || !String(input.station).trim()) return json(res, 400, { detail: 'Operator and station are required.' });
      for (const field of ['confidence', 'calibration']) if (input[field] != null && (!Number.isFinite(Number(input[field])) || Number(input[field]) < 0 || Number(input[field]) > 100)) return json(res, 400, { detail: `${field} must be between 0 and 100.` });
      if (input.location && (!Number.isFinite(Number(input.location.lat)) || Math.abs(Number(input.location.lat)) > 90 || !Number.isFinite(Number(input.location.lng)) || Math.abs(Number(input.location.lng)) > 180 || !Number.isFinite(Number(input.location.accuracy)) || Number(input.location.accuracy) < 0)) return json(res, 400, { detail: 'Location coordinates or accuracy are invalid.' });
      const fileMatch = String(input.imageData).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!fileMatch) return json(res, 415, { detail: 'Upload a JPEG, PNG, or WebP capture.' });
      const image = Buffer.from(fileMatch[2], 'base64');
      if (!image.length || image.length > maxImageBytes) return json(res, 413, { detail: 'Capture must be between 1 byte and 8 MB.' });
      const sequence = Math.max(0, ...records.map((item) => Number(item.id.slice(-6)))) + 1;
      const id = `CT-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;
      const imageHash = digest(image);
      const imagePath = join(imageDir, `${id}.${fileMatch[1]}`);
      await writeFile(imagePath, image, { flag: 'wx' });
      const result = input.quality === 'Fail' ? 'RETAKE REQUIRED' : input.classification || 'INCONCLUSIVE';
      const previous = records[0]?.recordHash || null;
      const record = { id, result, confidence: ['INCONCLUSIVE', 'RETAKE REQUIRED'].includes(result) ? result === 'INCONCLUSIVE' ? Number(input.confidence ?? 61) : null : Number(input.confidence ?? 82), officer: String(input.officer).trim().slice(0, 80), station: String(input.station).trim().slice(0, 120), captured: now(), kit: 'Demo Colorimetric Kit', kitId: String(input.kitId).slice(0, 80), profileVersion: '1.2.0', quality: input.quality || 'Pass', calibration: Number(input.calibration ?? 78), sync: input.offline ? 'Pending sync' : 'Synced', location: input.location ? { lat: Number(input.location.lat), lng: Number(input.location.lng), accuracy: Number(input.location.accuracy) } : null, model: input.classification && input.classification !== 'INCONCLUSIVE' ? 'synthetic-demo-outcome-0.1' : 'no-validated-model', synthetic: false, imagePath, imageHash, originalImageHash: imageHash, previousAuditHash: previous, audit: [], auditHash: null };
      seal(record, previous);
      records.unshift(record);
      await save();
      publish('test.created', record);
      if (!input.offline) publish('test.synced', record);
      return json(res, 201, { test: publicRecord(record) });
    }
    const match = url.pathname.match(/^\/api\/tests\/(CT-\d{4}-\d{6}|LOCAL-[a-f0-9]{12})(?:\/(verify|sync|image))?$/);
    if (match) {
      const record = records.find((item) => item.id === match[1]);
      if (!record) return json(res, 404, { detail: 'Test record not found' });
      if (match[2] === 'verify') return json(res, 200, { test_id: record.id, ...await verifyRecord(record) });
      if (match[2] === 'sync' && req.method === 'POST') {
        record.sync = 'Synced';
        appendAudit(record, 'Server synchronization receipt recorded');
        await save();
        publish('test.synced', record);
        return json(res, 200, { test: publicRecord(record) });
      }
      if (match[2] === 'image' && req.method === 'GET') {
        if (!record.imagePath) return json(res, 404, { detail: 'Synthetic fixture has no source image.' });
        const image = await readFile(record.imagePath);
        res.writeHead(200, { 'Content-Type': `image/${extname(record.imagePath).slice(1)}`, 'Cache-Control': 'no-store' });
        return res.end(image);
      }
      if (!match[2]) return json(res, 200, { test: publicRecord(record) });
      return json(res, 405, { detail: 'Method not allowed' });
    }
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const path = resolve(root, requested);
    const relativePath = relative(root, path);
    if (relativePath.startsWith('..') || relativePath.includes(':')) return json(res, 403, { detail: 'Forbidden' });
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    return res.end(content);
  } catch (error) {
    console.error(error);
    return json(res, error instanceof SyntaxError ? 400 : 500, { detail: error instanceof SyntaxError ? 'Invalid JSON request.' : 'Request could not be completed.' });
  }
});

await initialize();
server.listen(port, () => console.log(`ColorTrace prototype running at http://localhost:${port}`));
