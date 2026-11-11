// A small Google Drive client for the backups (lib/driveBackup.js): Sign in
// with Google, and the few Drive calls the backups need. Plain REST through
// Electron's network stack (net.fetch: follows the system proxy), so no big
// Google library is needed.
//
// Sign-in: the browser opens Google's sign-in page; Google sends the answer
// back to a one-time local address (http://127.0.0.1:<port>) that this file
// listens on, with PKCE so the answer is only usable by this app. It needs an
// OAuth client of the "Desktop app" type from Google Cloud (Settings shows how).
//
// Scope "drive.file": Nexora sees only the files it created itself, never the
// rest of the Drive.

const { net, shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SIGN_IN_TIMEOUT = 5 * 60 * 1000;

// auth: the sign-in is no longer valid (sign in again)
// offline: Google couldn't be reached (try again later)
class DriveError extends Error {
  constructor(message, { status = 0, auth = false, offline = false } = {}) {
    super(message);
    this.status = status;
    this.auth = auth;
    this.offline = offline;
  }
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------- token storage

function encryptToken(token) {
  if (!token) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(token).toString('base64');
  return 'raw:' + token;
}

function decryptToken(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  if (stored.startsWith('raw:')) return stored.slice(4);
  return '';
}

// ---------------------------------------------------------------- http

async function call(url, options = {}) {
  let res;
  try {
    res = await net.fetch(url, options);
  } catch (e) {
    throw new DriveError("Can't reach Google right now (" + (e.message || 'no connection') + ').', { offline: true });
  }
  return res;
}

async function failFrom(res, what) {
  let detail = '';
  let reason = '';
  try {
    const body = await res.json();
    const err = body.error;
    if (typeof err === 'string') {
      reason = err;
      detail = body.error_description || err;
    } else if (err) {
      detail = err.message || '';
      reason = (err.errors && err.errors[0] && err.errors[0].reason) || err.status || '';
    }
  } catch (e) {
    /* not JSON */
  }
  if (reason === 'storageQuotaExceeded') {
    return new DriveError('Your Google Drive is full. Free up space in Google Drive and the backups carry on.', { status: res.status });
  }
  const auth = res.status === 401 || reason === 'invalid_grant' || reason === 'unauthorized_client';
  if (auth) {
    return new DriveError('The Google sign-in has expired or was removed. Sign in with Google again.', { status: res.status, auth: true });
  }
  const offline = res.status >= 500 || res.status === 429;
  return new DriveError(`${what} failed (${res.status}${detail ? ': ' + detail : ''}).`, { status: res.status, offline });
}

function form(params) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  };
}

function emailFromIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')).email || '';
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------- sign-in

let pendingSignIn = null; // { cancel }

function cancelSignIn() {
  if (pendingSignIn) pendingSignIn.cancel(new DriveError('Sign-in was cancelled.'));
}

const PAGE = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><title>Nexora</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#eef1f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
div{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.1);text-align:center;max-width:420px}
h1{color:#3e9e8a;font-size:22px;margin:0 0 8px}p{color:#4c5667;margin:0}</style></head>
<body><div><h1>${title}</h1><p>${text}</p></div></body></html>`;

// opens the browser at Google's sign-in; resolves with the tokens and the e-mail
function signIn({ clientId, clientSecret }) {
  cancelSignIn();
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let redirectUri = '';
    let finished = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (url.searchParams.get('state') !== state || (!code && !error)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Something went wrong', 'Please go back to Nexora and try again.'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(PAGE('Not signed in', 'Google sign-in was not completed. You can close this tab and go back to Nexora.'));
        // access_denied: cancelled by the user - or blocked because the Google
        // Cloud app is still in "Testing" and this account isn't a test user
        done(new DriveError(error === 'access_denied'
          ? 'Google did not allow the sign-in. If Google said the app "has not completed the verification process", open Google Cloud > Google Auth Platform > Audience and click Publish app (or add your Gmail as a test user), then sign in again.'
          : 'Google sign-in failed: ' + error));
        return;
      }
      res.end(PAGE('Signed in to Google Drive', 'Nexora can now back up your data. You can close this tab and go back to Nexora.'));
      exchange(code).then((t) => done(null, t), (e) => done(e));
    });

    const timer = setTimeout(() => done(new DriveError('Sign-in timed out. Please try again.')), SIGN_IN_TIMEOUT);

    function done(err, tokens) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pendingSignIn = null;
      setTimeout(() => server.close(), 1000);
      if (err) reject(err);
      else resolve(tokens);
    }
    pendingSignIn = { cancel: (e) => done(e) };

    async function exchange(code) {
      const res = await call(TOKEN_URL, form({
        code,
        client_id: clientId,
        client_secret: clientSecret || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }));
      if (!res.ok) throw await failFrom(res, 'Google sign-in');
      const t = await res.json();
      if (!t.refresh_token) {
        throw new DriveError('Google did not give Nexora lasting access. Remove Nexora at myaccount.google.com/permissions and sign in again.');
      }
      return {
        refreshToken: t.refresh_token,
        accessToken: t.access_token,
        expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
        email: emailFromIdToken(t.id_token || ''),
      };
    }

    server.on('error', (e) => done(new DriveError('Could not start the sign-in: ' + e.message)));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = AUTH_URL + '?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      shell.openExternal(url).catch((e) => done(new DriveError('Could not open the browser: ' + e.message)));
    });
  });
}

async function refreshAccess({ clientId, clientSecret, refreshToken }) {
  const res = await call(TOKEN_URL, form({
    client_id: clientId,
    client_secret: clientSecret || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }));
  if (!res.ok) throw await failFrom(res, 'Google sign-in');
  const t = await res.json();
  return { accessToken: t.access_token, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
}

async function revoke(refreshToken) {
  try {
    await call(REVOKE_URL, form({ token: refreshToken }));
  } catch (e) {
    /* offline: the token is dropped here anyway */
  }
}

// ---------------------------------------------------------------- Drive

// getToken(force) returns an access token (force: a new one)
function driveClient(getToken) {
  async function request(method, url, { json, body, headers = {}, raw = false, what = 'Google Drive' } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken(attempt > 0);
      const opts = { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, headers) };
      if (json !== undefined) {
        opts.headers['Content-Type'] = 'application/json; charset=UTF-8';
        opts.body = JSON.stringify(json);
      } else if (body !== undefined) {
        opts.body = body;
      }
      const res = await call(url, opts);
      if (res.status === 401 && attempt === 0) continue; // the token ran out: once more with a new one
      if (!res.ok) throw await failFrom(res, what);
      if (raw) return res;
      if (res.status === 204) return null;
      return res.json();
    }
    throw new DriveError('The Google sign-in has expired. Sign in with Google again.', { auth: true });
  }

  const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return {
    // the backups folder: the one saved before (if still there), else found or created
    async ensureFolder(name, knownId) {
      if (knownId) {
        try {
          const f = await request('GET', `${DRIVE}/files/${encodeURIComponent(knownId)}?fields=id,trashed`);
          if (f && !f.trashed) return f.id;
        } catch (e) {
          if (e.auth || e.offline) throw e; // otherwise: gone, find / make a new one
        }
      }
      const query = `mimeType='${FOLDER_MIME}' and name='${q(name)}' and trashed=false`;
      const found = await request('GET', `${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=10`);
      if (found.files && found.files.length) return found.files[0].id;
      const made = await request('POST', `${DRIVE}/files?fields=id`, { json: { name, mimeType: FOLDER_MIME }, what: 'Creating the Drive folder' });
      return made.id;
    },

    // resumable upload: the session first, then the bytes in one go
    async upload(folderId, name, buffer, appProperties) {
      const start = await request('POST', `${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, {
        json: { name, parents: [folderId], mimeType: 'application/zip', appProperties },
        headers: { 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(buffer.length) },
        raw: true,
        what: 'Starting the upload',
      });
      const session = start.headers.get('location');
      if (!session) throw new DriveError('Google Drive did not start the upload.');
      const res = await call(session, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: buffer });
      if (!res.ok) throw await failFrom(res, 'Uploading the backup');
      return res.json();
    },

    async list(folderId) {
      const query = `'${q(folderId)}' in parents and trashed=false`;
      const files = [];
      let page = '';
      do {
        const r = await request('GET',
          `${DRIVE}/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,size,createdTime,appProperties)&pageSize=1000&orderBy=createdTime desc` +
            (page ? '&pageToken=' + encodeURIComponent(page) : ''));
        files.push(...(r.files || []));
        page = r.nextPageToken || '';
      } while (page);
      return files;
    },

    async remove(fileId) {
      await request('DELETE', `${DRIVE}/files/${encodeURIComponent(fileId)}`, { what: 'Removing an old backup' });
    },

    async download(fileId) {
      const res = await request('GET', `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true, what: 'Downloading the backup' });
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

module.exports = { DriveError, signIn, cancelSignIn, refreshAccess, revoke, driveClient, encryptToken, decryptToken };
