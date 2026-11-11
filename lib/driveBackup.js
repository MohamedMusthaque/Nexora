// Google Drive backup: keeps a copy of all data in the user's Google Drive.
//
//   1. Snapshot: when the data changes, the whole "POS" data folder is zipped
//      into a local queue (<data root>/Nexora-Backups/drive-queue). This
//      needs no internet, so nothing is lost while offline.
//   2. Upload: whenever the PC is online, the queued snapshot goes up to the
//      "Nexora Backups" folder in Google Drive. A failed upload is retried
//      (1, 2, 4 ... 30 minutes apart, and at once when the connection comes
//      back); only the newest snapshot waits - each one holds all the data.
//
// When: a minute or two after changes (once they settle, or every
// CHANGE_MAX_WAIT on a busy till), at start-up if anything changed, and when
// the app closes. Drive keeps this PC's newest KEEP_RECENT backups plus the
// newest of each of the last KEEP_DAYS days.
// Restore: a backup is downloaded and unpacked beside the data, and swapped
// in on the next start (the datastores are open while the app runs), after
// a copy of the current data is saved in "<data root>/Nexora-Backups".

const { app, net, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const log = require('electron-log');
const JSZip = require('jszip');
const gd = require('./googleDrive');
const {
  getDataRoot, getPosDir, getDriveConfig, setDriveConfig, setPendingRestore, takePendingRestore,
} = require('./dataConfig');

const CHECK_EVERY = 60 * 1000;
const FIRST_CHECK = 20 * 1000;
const CHANGE_MAX_WAIT = 10 * 60 * 1000;
const RETRY_MAX = 30 * 60 * 1000;
const KEEP_RECENT = 20;
const KEEP_DAYS = 30;
const FOLDER_NAME = 'Nexora Backups';
const STAMP_RE = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.zip$/;
const MANIFEST = 'nexora-backup.json';

let getWindow = () => null;
let timer = null;
let running = false;
let runAgain = false;
let signingIn = false;
let pendingSince = 0;
let lastSeenSig = '';
let failures = 0;
let nextRetryAt = 0;
let access = { token: '', expiresAt: 0 };
let quitDone = false;

// ---------------------------------------------------------------- helpers

function machineName() {
  return (os.hostname() || 'This PC').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'This_PC';
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function stampDate(name) {
  const m = String(name).match(STAMP_RE);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function queueDir() {
  return path.join(getDataRoot(), 'Nexora-Backups', 'drive-queue');
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.isFile() && !entry.name.endsWith('~')) out.push(full); // not nedb's temporary "*.db~"
  }
  return out;
}

// changes when any data file is added, removed or written
function dataSignature() {
  const posDir = getPosDir();
  const parts = listFiles(posDir).map((f) => {
    const st = fs.statSync(f);
    return path.relative(posDir, f) + ':' + st.size + ':' + Math.floor(st.mtimeMs);
  });
  return crypto.createHash('sha1').update(parts.sort().join('|')).digest('hex');
}

function isOnline() {
  try {
    return net.isOnline();
  } catch (e) {
    return true;
  }
}

function credentials() {
  const cfg = getDriveConfig();
  return {
    clientId: (cfg.clientId || process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (cfg.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  };
}

function queuedSnapshot() {
  const cfg = getDriveConfig();
  if (!cfg.queued || !fs.existsSync(cfg.queued.file)) return null;
  return cfg.queued;
}

// ---------------------------------------------------------------- Google access

async function accessToken(force) {
  if (!force && access.token && Date.now() < access.expiresAt - 60 * 1000) return access.token;
  const cfg = getDriveConfig();
  const refreshToken = gd.decryptToken(cfg.refreshToken);
  if (!refreshToken) throw new gd.DriveError('Not signed in to Google Drive.', { auth: true });
  try {
    const t = await gd.refreshAccess(Object.assign(credentials(), { refreshToken }));
    access = { token: t.accessToken, expiresAt: t.expiresAt };
    return access.token;
  } catch (e) {
    if (e.auth) setDriveConfig({ authError: true });
    throw e;
  }
}

const drive = gd.driveClient(accessToken);

async function driveFolder() {
  const cfg = getDriveConfig();
  const id = await drive.ensureFolder(FOLDER_NAME, cfg.folderId);
  if (id !== cfg.folderId) setDriveConfig({ folderId: id });
  return id;
}

// ---------------------------------------------------------------- status

function status() {
  const cfg = getDriveConfig();
  const creds = credentials();
  const connected = !!cfg.refreshToken;
  let changed = false;
  try {
    changed = connected && cfg.enabled && dataSignature() !== cfg.snapshotSignature;
  } catch (e) {
    /* shown through lastError */
  }
  const queued = queuedSnapshot();
  return {
    configured: !!creds.clientId,
    clientId: creds.clientId,
    clientFromEnv: !cfg.clientId && !!process.env.GOOGLE_CLIENT_ID,
    connected,
    email: cfg.email || '',
    enabled: connected && !!cfg.enabled,
    authError: !!cfg.authError,
    signingIn,
    online: isOnline(),
    running,
    pending: changed || !!queued,
    queuedAt: queued ? queued.created : null,
    nextRetryAt: queued && nextRetryAt > Date.now() ? new Date(nextRetryAt).toISOString() : null,
    lastBackupAt: cfg.lastBackupAt || null,
    lastBackupName: cfg.lastBackupName || '',
    lastError: cfg.lastError || '',
    folderUrl: cfg.folderId ? 'https://drive.google.com/drive/folders/' + cfg.folderId : '',
    machine: machineName(),
  };
}

function pushStatus() {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('drive-backup:status', status());
}

// ---------------------------------------------------------------- snapshot (local)

async function takeSnapshot(reason) {
  const posDir = getPosDir();
  const signature = dataSignature();
  const files = listFiles(posDir);
  const zip = new JSZip();
  for (const f of files) {
    zip.file('POS/' + path.relative(posDir, f).split(path.sep).join('/'), fs.readFileSync(f), { date: fs.statSync(f).mtime });
  }
  const now = new Date();
  zip.file(MANIFEST, JSON.stringify({
    app: 'Nexora',
    version: app.getVersion(),
    created_at: now.toISOString(),
    machine: machineName(),
    reason: reason || 'auto',
    files: files.length,
  }, null, 2));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  const dir = queueDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `Nexora-Backup-${machineName()}-${stamp(now)}.zip`;
  const file = path.join(dir, name);
  fs.writeFileSync(file + '.partial', buffer);
  fs.renameSync(file + '.partial', file);
  // only the newest waits: each snapshot holds all the data
  for (const f of fs.readdirSync(dir)) {
    if (f !== name) fs.rmSync(path.join(dir, f), { force: true });
  }
  setDriveConfig({ queued: { file, name, created: now.toISOString(), size: buffer.length }, snapshotSignature: signature });
  pendingSince = 0;
  return { file, name };
}

// ---------------------------------------------------------------- upload

async function prune(folderId) {
  const mine = (await drive.list(folderId)).filter((f) => f.appProperties && f.appProperties.machine === machineName());
  mine.sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first (the name ends with the time)
  const keep = new Set(mine.slice(0, KEEP_RECENT).map((f) => f.id));
  const days = new Set();
  const oldest = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  for (const f of mine) {
    const d = stampDate(f.name);
    if (!d || d.getTime() < oldest) continue;
    const day = d.toDateString();
    if (!days.has(day)) {
      days.add(day);
      keep.add(f.id);
    }
  }
  for (const f of mine) {
    if (!keep.has(f.id)) {
      try {
        await drive.remove(f.id);
      } catch (e) {
        log.warn('Drive backup: could not remove', f.name, e.message);
      }
    }
  }
}

async function uploadQueued() {
  const queued = queuedSnapshot();
  if (!queued) return null;
  const folderId = await driveFolder();
  const buffer = fs.readFileSync(queued.file);
  await drive.upload(folderId, queued.name, buffer, {
    nexora: 'backup',
    machine: machineName(),
    created: queued.created,
  });
  fs.rmSync(queued.file, { force: true });
  setDriveConfig({ queued: undefined, lastBackupAt: new Date().toISOString(), lastBackupName: queued.name, lastError: '', authError: false });
  failures = 0;
  nextRetryAt = 0;
  log.info(`Drive backup uploaded: ${queued.name} (${Math.round(buffer.length / 1024)} KB)`);
  try {
    await prune(folderId);
  } catch (e) {
    log.warn('Drive backup: pruning failed:', e.message);
  }
  return queued.name;
}

// snapshot when asked or changed, then upload when online
async function run({ reason = 'changes', snapshot = false } = {}) {
  const cfg = getDriveConfig();
  if (!cfg.refreshToken) return { success: false, error: 'Sign in with Google first.' };
  if (running) {
    runAgain = true;
    return { success: true, busy: true };
  }
  running = true;
  pushStatus();
  try {
    if (snapshot) await takeSnapshot(reason);
    if (!queuedSnapshot()) return { success: true, upToDate: true };
    if (!isOnline()) {
      return { success: true, offline: true }; // waits in the queue: goes up when online
    }
    const name = await uploadQueued();
    return { success: true, uploaded: name };
  } catch (e) {
    failures++;
    nextRetryAt = Date.now() + Math.min(Math.pow(2, failures - 1) * 60 * 1000, RETRY_MAX);
    if (e.offline) {
      log.warn('Drive backup: offline, will retry:', e.message);
      setDriveConfig({ lastError: '' }); // not a problem: it waits for the connection
      return { success: true, offline: true };
    }
    log.error('Drive backup failed:', e);
    setDriveConfig({ lastError: e.message });
    return { success: false, error: e.message, auth: !!e.auth };
  } finally {
    running = false;
    pushStatus();
    if (runAgain) {
      runAgain = false;
      setTimeout(() => check(true), 1000);
    }
  }
}

// once a minute (and when the connection comes back)
async function check(now) {
  const cfg = getDriveConfig();
  if (!cfg.refreshToken || !cfg.enabled || cfg.authError) {
    pushStatus();
    return;
  }
  let sig;
  try {
    sig = dataSignature();
  } catch (e) {
    setDriveConfig({ lastError: 'Could not read the data folder: ' + e.message });
    pushStatus();
    return;
  }
  let snapshot = false;
  if (sig !== cfg.snapshotSignature) {
    if (!pendingSince) pendingSince = Date.now();
    const settled = sig === lastSeenSig;
    snapshot = settled || Date.now() - pendingSince >= CHANGE_MAX_WAIT;
  } else {
    pendingSince = 0;
  }
  lastSeenSig = sig;

  const waiting = !!queuedSnapshot();
  if (snapshot || (waiting && (now || Date.now() >= nextRetryAt))) {
    await run({ reason: 'changes', snapshot });
  } else {
    pushStatus();
  }
}

// ---------------------------------------------------------------- restore

async function listBackups() {
  const folderId = await driveFolder();
  return (await drive.list(folderId))
    .filter((f) => /\.zip$/.test(f.name))
    .map((f) => {
      const machine = (f.appProperties && f.appProperties.machine) || '';
      const d = stampDate(f.name);
      return {
        id: f.id,
        name: f.name,
        machine,
        thisMachine: machine === machineName(),
        created: (f.appProperties && f.appProperties.created) || (d ? d.toISOString() : f.createdTime),
        size: Number(f.size) || 0,
      };
    })
    .sort((a, b) => (a.created < b.created ? 1 : -1));
}

async function prepareRestore(fileId) {
  const buffer = await drive.download(fileId);
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file(MANIFEST) || !Object.keys(zip.files).some((n) => n.startsWith('POS/server/databases/'))) {
    return { success: false, error: 'This file does not look like a Nexora backup.' };
  }
  const dataRoot = getDataRoot();
  const staging = path.join(dataRoot, 'Nexora-Restore-Staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir || !name.startsWith('POS/')) continue;
    const target = path.resolve(staging, name);
    if (!isInside(target, staging)) continue; // never outside the staging folder
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('nodebuffer'));
  }
  // a copy of the data as it is now, in case the wrong backup was picked
  const posDir = getPosDir();
  let safetyCopy = null;
  if (fs.existsSync(posDir)) {
    safetyCopy = path.join(dataRoot, 'Nexora-Backups', `Nexora-Backup-Before-Restore-${stamp(new Date())}`);
    fs.mkdirSync(safetyCopy, { recursive: true });
    fs.cpSync(posDir, path.join(safetyCopy, 'POS'), { recursive: true });
  }
  setPendingRestore({ posDir, staging: path.join(staging, 'POS'), fileId, safetyCopy, requestedAt: new Date().toISOString() });
  log.info('Drive restore scheduled from', fileId, '| current data saved to', safetyCopy);
  return { success: true, safetyCopy };
}

// start.js, before the datastores open: swap the unpacked backup in
function applyPendingRestore() {
  try {
    const request = takePendingRestore();
    if (!request) return;
    const posDir = getPosDir();
    if (path.resolve(request.posDir) !== path.resolve(posDir)) {
      log.warn('Pending restore skipped: data location changed.');
      return;
    }
    if (!fs.existsSync(path.join(request.staging, 'server', 'databases'))) {
      log.warn('Pending restore skipped: unpacked backup missing.');
      return;
    }
    fs.rmSync(posDir, { recursive: true, force: true });
    try {
      fs.renameSync(request.staging, posDir);
    } catch (e) {
      fs.cpSync(request.staging, posDir, { recursive: true });
    }
    fs.rmSync(path.dirname(request.staging), { recursive: true, force: true });
    log.info('Restore from Google Drive done:', request.fileId);
  } catch (e) {
    log.error('Restore from Google Drive failed:', e);
  }
}

// ---------------------------------------------------------------- set-up

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log.error(channel, e);
      return { success: false, error: e.message, auth: !!e.auth, offline: !!e.offline };
    }
  });
}

function init(options) {
  getWindow = options.getWindow || getWindow;

  handle('drive-backup:status', () => status());

  // the OAuth client (Google Cloud > Credentials > "Desktop app")
  handle('drive-backup:set-client', (clientId, clientSecret) => {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      return { success: false, error: 'The Client ID looks like 123456-abc.apps.googleusercontent.com. Copy it from Google Cloud > Credentials.' };
    }
    setDriveConfig({ clientId, clientSecret });
    pushStatus();
    return { success: true, status: status() };
  });

  handle('drive-backup:sign-in', async () => {
    const creds = credentials();
    if (!creds.clientId) return { success: false, error: 'Enter the Google Client ID first.' };
    signingIn = true;
    pushStatus();
    try {
      const t = await gd.signIn(creds);
      access = { token: t.accessToken, expiresAt: t.expiresAt };
      setDriveConfig({
        refreshToken: gd.encryptToken(t.refreshToken),
        email: t.email,
        enabled: true,
        authError: false,
        lastError: '',
        snapshotSignature: '',
      });
    } finally {
      signingIn = false;
      pushStatus();
    }
    // the first backup straight away
    const result = await run({ reason: 'first backup', snapshot: true });
    return Object.assign({ status: status(), email: getDriveConfig().email }, result, { success: true, backup: result });
  });

  handle('drive-backup:cancel-sign-in', () => {
    gd.cancelSignIn();
    return { success: true };
  });

  handle('drive-backup:sign-out', async () => {
    const cfg = getDriveConfig();
    const token = gd.decryptToken(cfg.refreshToken);
    if (token) await gd.revoke(token);
    access = { token: '', expiresAt: 0 };
    setDriveConfig({ refreshToken: undefined, email: undefined, enabled: false, authError: false, lastError: '', folderId: undefined });
    pushStatus();
    return { success: true, status: status() };
  });

  handle('drive-backup:set-enabled', (enabled) => {
    setDriveConfig({ enabled: !!enabled });
    if (enabled) setTimeout(() => check(true), 500);
    pushStatus();
    return status();
  });

  handle('drive-backup:run', () => run({ reason: 'manual', snapshot: true }));
  // the connection is back (renderer "online" event): try straight away
  handle('drive-backup:poke', () => {
    setTimeout(() => check(true), 1500);
    return { success: true };
  });
  handle('drive-backup:list', async () => ({ success: true, backups: await listBackups() }));
  handle('drive-backup:restore', (fileId) => prepareRestore(fileId));
  handle('drive-backup:open-folder', () => {
    const s = status();
    shell.openExternal(s.folderUrl || 'https://drive.google.com/');
    return { success: true };
  });
  handle('drive-backup:open-url', (url) => {
    // only Google's own pages (the set-up help links)
    if (/^https:\/\/(console\.cloud\.google\.com|myaccount\.google\.com|drive\.google\.com)\//.test(url)) shell.openExternal(url);
    return { success: true };
  });

  setTimeout(() => check(true), FIRST_CHECK);
  timer = setInterval(() => check(false), CHECK_EVERY);

  // closing: snapshot anything not yet saved (quick, local), and upload it if
  // online (at most 20 s); otherwise it goes up at the next start
  app.on('before-quit', (event) => {
    if (quitDone) return;
    const cfg = getDriveConfig();
    let changed = false;
    try {
      changed = !!(cfg.refreshToken && cfg.enabled && !cfg.authError && dataSignature() !== cfg.snapshotSignature);
    } catch (e) {
      changed = false;
    }
    if (!changed) return;
    event.preventDefault();
    quitDone = true;
    clearInterval(timer);
    Promise.race([run({ reason: 'closing', snapshot: true }), new Promise((r) => setTimeout(r, 20000))]).finally(() => app.quit());
  });
}

module.exports = { init, applyPendingRestore };
