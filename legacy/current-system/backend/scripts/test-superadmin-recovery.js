// End-to-end tests for Super Admin password recovery (node:test + fetch; no extra dependencies).
//
// LOCAL ONLY. Requires:
//   - backend/.env pointing at the local recovery DB (never a shared or production database)
//   - migration 046 applied to that DB
//   - Mailpit on localhost (SMTP 1025, API 8025):
//       docker run -d --name alphakolect-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit
// Run from backend/:
//   node --test scripts/test-superadmin-recovery.js
//
// The script starts its own server on TEST_PORT (fresh in-memory rate limits), creates a throwaway
// super admin and merchant, and deletes them afterwards. Real accounts are never modified.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(backendDir, '.env') });

const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { getDbSettings, sslDialectOptions } = require('../config/database');

const TEST_PORT = Number(process.env.TEST_PORT || 5099);
const API = `http://localhost:${TEST_PORT}`;
const MAILPIT_API = process.env.MAILPIT_API || 'http://localhost:8025/api/v1';
const ADMIN_APP_URL = 'http://localhost:3000';

const run = crypto.randomBytes(4).toString('hex');
const adminEmail = `recovery-test-${run}@example.test`;
const merchantEmail = `recovery-merchant-${run}@example.test`;
const initialPassword = `Initial#${run}A1`;
const newPassword = `Changed#${run}B2`;
const merchantPassword = `Merchant#${run}C3`;

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let db;
let server;
let serverOutput = '';
let adminId;
let merchantId;
const issuedTokens = [];

const post = async (url, body, headers = {}) => {
  const res = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const get = async (url, jwt) => {
  const res = await fetch(`${API}${url}`, { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const mailIdsFor = async (email) => {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const data = await res.json();
  return (data.messages || []).map((m) => m.ID);
};

// Wait for a new reset email to `email` and return the token from its link
const waitForResetToken = async (email, knownIds) => {
  for (let i = 0; i < 50; i++) {
    const ids = await mailIdsFor(email);
    const fresh = ids.find((id) => !knownIds.includes(id));
    if (fresh) {
      knownIds.push(fresh);
      const msg = await (await fetch(`${MAILPIT_API}/message/${fresh}`)).json();
      const match = /\/admin\/reset-password\?token=([A-Za-z0-9_\-%]+)/.exec(msg.Text || '');
      assert.ok(match, 'reset email should contain a reset link');
      assert.ok((msg.Text || '').includes(`${ADMIN_APP_URL}/admin/reset-password?token=`), 'link uses ADMIN_APP_URL');
      const token = decodeURIComponent(match[1]);
      issuedTokens.push(token);
      return token;
    }
    await sleep(200);
  }
  throw new Error(`No reset email arrived for ${email}`);
};

// forgot-password answers before processing; wait until the DB row for this admin appears
const waitForResetRows = async (count) => {
  for (let i = 0; i < 50; i++) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM super_admin_password_resets WHERE super_admin_id = $1', [adminId]);
    if (rows[0].n >= count) return;
    await sleep(100);
  }
  throw new Error('reset row was not created');
};

before(async () => {
  const settings = getDbSettings();
  const { ssl } = sslDialectOptions();
  db = new Client(settings.url
    ? { connectionString: settings.url, ssl }
    : { host: settings.host, port: settings.port, database: settings.database, user: settings.username, password: settings.password, ssl });
  await db.connect();

  const migrated = await db.query("SELECT to_regclass('public.super_admin_password_resets') AS t");
  assert.ok(migrated.rows[0].t, 'apply migrations/046_super_admin_password_resets.sql first');

  const adminHash = await bcrypt.hash(initialPassword, 10);
  const adminRow = await db.query(
    `INSERT INTO super_admins (name, email, password, role, created_at, updated_at)
     VALUES ('Recovery Test', $1, $2, 'superadmin', now(), now()) RETURNING id`,
    [adminEmail, adminHash]
  );
  adminId = adminRow.rows[0].id;

  const merchantHash = await bcrypt.hash(merchantPassword, 10);
  const merchantRow = await db.query(
    `INSERT INTO merchants (email, password, "isVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, true, now(), now()) RETURNING id`,
    [merchantEmail, merchantHash]
  );
  merchantId = merchantRow.rows[0].id;

  server = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      ADMIN_APP_URL,
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      EMAIL_USER: '',
      EMAIL_PASS: '',
      EMAIL_DISABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverOutput += d; });
  server.stderr.on('data', (d) => { serverOutput += d; });

  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error(`server did not start:\n${serverOutput}`);
});

after(async () => {
  if (server) server.kill();
  if (db) {
    if (adminId) {
      await db.query(`DELETE FROM activities WHERE action LIKE 'SUPERADMIN_PASSWORD_RESET_%' AND details LIKE $1`, [`%super admin #${adminId} %`]);
      await db.query('DELETE FROM super_admins WHERE id = $1', [adminId]); // cascades to reset rows
    }
    if (merchantId) await db.query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    await db.end();
  }
  for (const email of [adminEmail, `nobody-${run}@example.test`]) {
    await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: 'DELETE' }).catch(() => {});
  }
});

describe('Super Admin password recovery', () => {
  const knownMailIds = [];
  let oldJwt;
  let firstToken;

  it('health endpoint responds OK', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'OK');
  });

  it('login works with the current password, is case-insensitive, and issues a usable JWT', async () => {
    const res = await post('/superadmin/login', { email: adminEmail.toUpperCase(), password: initialPassword });
    assert.equal(res.status, 200);
    oldJwt = res.body.token;
    const stats = await get('/superadmin/superStats', oldJwt);
    assert.equal(stats.status, 200);
  });

  it('forgot-password gives the identical generic response for unknown and known emails', async () => {
    const unknown = await post('/superadmin/forgot-password', { email: `nobody-${run}@example.test` });
    const known = await post('/superadmin/forgot-password', { email: `  ${adminEmail.toUpperCase()} ` });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(known.body.message, 'If an account exists, a reset link has been sent');
    assert.ok(!('token' in known.body));

    firstToken = await waitForResetToken(adminEmail, knownMailIds);
    await waitForResetRows(1);
    assert.equal((await mailIdsFor(`nobody-${run}@example.test`)).length, 0, 'no email for unknown address');
  });

  it('stores only the sha256 hash of the token, with a ~30 minute expiry', async () => {
    const { rows } = await db.query(
      `SELECT *, extract(epoch FROM (expires_at - created_at)) AS ttl FROM super_admin_password_resets WHERE super_admin_id = $1`,
      [adminId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, sha256(firstToken));
    assert.ok(Math.abs(Number(rows[0].ttl) - 1800) < 5, 'expiry is 30 minutes');
    assert.ok(!JSON.stringify(rows).includes(firstToken), 'raw token is not stored');
  });

  it('rejects a wrong token with a generic 400', async () => {
    const res = await post('/superadmin/reset-password', { token: crypto.randomBytes(32).toString('base64url'), newPassword });
    assert.equal(res.status, 400);
  });

  it('rejects an expired token with a generic 400', async () => {
    const expired = crypto.randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO super_admin_password_resets (super_admin_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, now() - interval '1 minute', now() - interval '31 minutes')`,
      [adminId, sha256(expired)]
    );
    const res = await post('/superadmin/reset-password', { token: expired, newPassword });
    assert.equal(res.status, 400);
  });

  it('rejects a weak password server-side (422) without consuming the token', async () => {
    const res = await post('/superadmin/reset-password', { token: firstToken, newPassword: 'weakpass' });
    assert.equal(res.status, 422);
    const { rows } = await db.query('SELECT used_at FROM super_admin_password_resets WHERE token_hash = $1', [sha256(firstToken)]);
    assert.equal(rows[0].used_at, null);
  });

  it('requesting a new link invalidates the previous unused link', async () => {
    await post('/superadmin/forgot-password', { email: adminEmail });
    await waitForResetToken(adminEmail, knownMailIds);
    await waitForResetRows(3); // first + expired fixture + this one
    const res = await post('/superadmin/reset-password', { token: firstToken, newPassword });
    assert.equal(res.status, 400);
  });

  let latestToken;
  it('a valid token resets the password; old password and old JWT stop working', async () => {
    await post('/superadmin/forgot-password', { email: adminEmail });
    latestToken = await waitForResetToken(adminEmail, knownMailIds);

    // Ensure the reset happens in a later second than the old JWT's iat
    await sleep(1100);
    const res = await post('/superadmin/reset-password', { token: latestToken, newPassword });
    assert.equal(res.status, 200);

    const { rows } = await db.query('SELECT password_changed_at FROM super_admins WHERE id = $1', [adminId]);
    assert.ok(rows[0].password_changed_at, 'password_changed_at is set');

    const oldLogin = await post('/superadmin/login', { email: adminEmail, password: initialPassword });
    assert.equal(oldLogin.status, 401);

    const oldSession = await get('/superadmin/superStats', oldJwt);
    assert.equal(oldSession.status, 401, 'JWT issued before the reset is rejected');

    const newLogin = await post('/superadmin/login', { email: adminEmail, password: newPassword });
    assert.equal(newLogin.status, 200);
    const newSession = await get('/superadmin/superStats', newLogin.body.token);
    assert.equal(newSession.status, 200, 'JWT issued after the reset works (even within the same second)');
  });

  it('rejects reuse of a token that was already used', async () => {
    const res = await post('/superadmin/reset-password', { token: latestToken, newPassword: `Another#${run}D4` });
    assert.equal(res.status, 400);
  });

  it('writes audit entries without secrets', async () => {
    const { rows } = await db.query(
      `SELECT action, details FROM activities WHERE action LIKE 'SUPERADMIN_PASSWORD_RESET_%' AND details LIKE $1`,
      [`%super admin #${adminId} %`]
    );
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('SUPERADMIN_PASSWORD_RESET_REQUESTED'));
    assert.ok(actions.includes('SUPERADMIN_PASSWORD_RESET_COMPLETED'));
    const text = JSON.stringify(rows);
    for (const token of issuedTokens) assert.ok(!text.includes(token));
    assert.ok(!text.includes(newPassword) && !text.includes(initialPassword));
  });

  it('a JWT for a deleted super admin is rejected', async () => {
    const tmp = await db.query(
      `INSERT INTO super_admins (name, email, password, role, created_at, updated_at)
       VALUES ('Temp', $1, $2, 'superadmin', now(), now()) RETURNING id`,
      [`recovery-temp-${run}@example.test`, await bcrypt.hash(initialPassword, 10)]
    );
    const login = await post('/superadmin/login', { email: `recovery-temp-${run}@example.test`, password: initialPassword });
    assert.equal(login.status, 200);
    await db.query('DELETE FROM super_admins WHERE id = $1', [tmp.rows[0].id]);
    const res = await get('/superadmin/superStats', login.body.token);
    assert.equal(res.status, 401);
  });

  it('forgot-password is rate limited per email (429)', async () => {
    const email = `ratelimit-${run}@example.test`;
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post('/superadmin/forgot-password', { email })).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  it('reset-password is rate limited per IP (429)', async () => {
    // Several reset calls were made above; the per-IP limit is 10 per 15 minutes
    let status;
    for (let i = 0; i < 10; i++) {
      status = (await post('/superadmin/reset-password', { token: 'x', newPassword })).status;
      if (status === 429) break;
    }
    assert.equal(status, 429);
  });

  it('login is rate limited per email (429)', async () => {
    const email = `login-limit-${run}@example.test`;
    let status;
    for (let i = 0; i < 11; i++) status = (await post('/superadmin/login', { email, password: 'wrong' })).status;
    assert.equal(status, 429);
  });

  it('merchant login still works unchanged', async () => {
    const bad = await post('/merchant/login', { email: merchantEmail, password: 'wrong-password' });
    assert.equal(bad.status, 401);
    const ok = await post('/merchant/login', { email: merchantEmail, password: merchantPassword });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
  });

  it('the server never logged a reset token', () => {
    for (const token of issuedTokens) assert.ok(!serverOutput.includes(token), 'token found in server output');
  });
});
