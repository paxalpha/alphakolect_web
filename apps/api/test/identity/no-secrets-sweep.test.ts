import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { AUTH_COOKIES, CSRF_HEADER } from '@alphakolect/contracts';
import request from 'supertest';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { bootstrapSuperAdmin } from '../../src/modules/identity/bootstrap.js';
import { MFA_CHALLENGE_COOKIE, SELECTION_CHALLENGE_COOKIE } from '../../src/modules/identity/cookies.js';
import { totpCode, totpStep } from '../../src/modules/identity/totp.js';
import { createDb } from '../../src/platform/db.js';
import { createLogger } from '../../src/platform/logger.js';
import { createTestApp, TEST_WEB_APP_URL, TEST_WEB_ORIGIN } from '../support/app.js';

// P3 exit criteria 3 and 11, end to end: every identity journey runs through the real app (real logger with
// its redaction, at trace level) and database while every secret it creates is collected. Then:
//   - no captured log line contains any of them;
//   - no response body or non-cookie header contains any of them — except the two enrolment responses whose
//     job is to show a secret once (the TOTP secret; the recovery codes), and only that secret;
//   - every state-changing auth request wrote an audit row, and no audit row contains any of them.

const lines: string[] = [];
const logStream = new Writable({
  write(chunk, _enc, done) {
    lines.push(String(chunk));
    done();
  },
});
const { app, email } = await createTestApp({ logger: createLogger({ logLevel: 'trace' }, logStream) });
const migrator = createDb(inject('ownerDatabaseUrl'));
afterAll(() => migrator.close());

const secrets = new Set<string>();
const keep = (...values: Array<string | undefined>) => {
  for (const v of values) if (v) secrets.add(v);
};
type Exchange = { label: string; res: request.Response; mayShow?: string[]; audited: boolean };
const exchanges: Exchange[] = [];

const clientIp = () => `10.${randomBytes(3).join('.')}`;
type Jar = Partial<Record<string, string>>;
const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

/** Sends a request as the web app would, records the exchange, and collects any cookie it sets as a secret. */
async function send(
  label: string,
  method: 'get' | 'post',
  path: string,
  {
    body,
    jar = {},
    audited = method === 'post',
    mayShow,
  }: { body?: object; jar?: Jar; audited?: boolean; mayShow?: string[] } = {},
): Promise<request.Response> {
  let req = request(app)[method](path).set('X-Forwarded-For', clientIp()).set('Origin', TEST_WEB_ORIGIN);
  if (Object.keys(jar).length) req = req.set('Cookie', cookieHeader(jar));
  if (jar[AUTH_COOKIES.csrf]) req = req.set(CSRF_HEADER, jar[AUTH_COOKIES.csrf]!);
  const res = await (body ? req.send(body) : req.send());
  for (const c of (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
    const [name, value] = c.split(';')[0]!.split('=') as [string, string];
    keep(value);
    if (value) jar[name] = value;
  }
  exchanges.push({ label, res, audited, ...(mayShow ? { mayShow } : {}) });
  return res;
}

async function linkToken(address: string, template: string): Promise<string> {
  await vi.waitFor(() => expect(email.to(address).some((m) => m.template === template)).toBe(true));
  const message = email
    .to(address)
    .filter((m) => m.template === template)
    .at(-1)!;
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(message.text)![1]!;
  keep(token);
  return token;
}

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}

describe('no secret leaves through a response, a log line or the audit log (exit criteria 3, 11)', () => {
  it('runs every identity journey', async () => {
    const [p1, p2, p3] = ['first long passphrase', 'second long passphrase', 'third long passphrase'];
    keep(p1, p2, p3, 'wrong long passphrase');

    // merchant owner: signup → verify → login → refresh → change → forgot → reset → login → logout
    const owner = `sweep-${randomBytes(5).toString('hex')}@example.test`;
    const jar: Jar = {};
    await send('signup', 'post', '/v1/auth/signup', {
      body: { email: owner, password: p1, businessName: 'Sweep Ltd' },
    });
    await send('verify email', 'post', '/v1/auth/email/verify', {
      body: { token: await linkToken(owner, 'email_verification') },
    });
    await send('resend (verified: no email)', 'post', '/v1/auth/email/resend', { body: { email: owner } });
    await send('login, wrong password', 'post', '/v1/auth/login', {
      body: { email: owner, password: 'wrong long passphrase', audience: 'merchant' },
    });
    await send('login', 'post', '/v1/auth/login', {
      body: { email: owner, password: p1, audience: 'merchant' },
      jar,
    });
    await send('session', 'get', '/v1/auth/session', { jar });
    await send('refresh', 'post', '/v1/auth/refresh', { jar });
    await send('refresh, invalid', 'post', '/v1/auth/refresh', {
      jar: {
        [AUTH_COOKIES.refresh]: randomBytes(32).toString('base64url'),
        [AUTH_COOKIES.csrf]: jar[AUTH_COOKIES.csrf],
      },
    });
    await send('change password', 'post', '/v1/auth/password/change', {
      body: { currentPassword: p1, newPassword: p2 },
      jar,
    });
    await send('forgot', 'post', '/v1/auth/password/forgot', { body: { email: owner } });
    await send('reset', 'post', '/v1/auth/password/reset', {
      body: { token: await linkToken(owner, 'password_reset'), password: p3 },
    });
    const again: Jar = {};
    await send('login again', 'post', '/v1/auth/login', {
      body: { email: owner, password: p3, audience: 'merchant' },
      jar: again,
    });
    await send('logout', 'post', '/v1/auth/logout', { jar: again });

    // super admin: bootstrap → setup → login (enrolment) → enrol → login → MFA verify (TOTP, then recovery code)
    const admin = `sweep-admin-${randomBytes(5).toString('hex')}@example.test`;
    await bootstrapSuperAdmin({
      migrator,
      sender: email,
      webAppUrl: TEST_WEB_APP_URL,
      email: admin,
      allowAdditional: true,
    });
    await send('account setup', 'post', '/v1/auth/password/setup', {
      body: { token: await linkToken(admin, 'account_setup'), password: p1 },
    });
    const enrolling: Jar = {};
    await send('platform login (enrolment)', 'post', '/v1/auth/login', {
      body: { email: admin, password: p1, audience: 'platform' },
      jar: enrolling,
    });
    const begin = await send('begin TOTP enrolment', 'post', '/v1/auth/mfa/totp/enrollment', {
      jar: enrolling,
    });
    const totpSecret = begin.body.secret as string;
    keep(totpSecret, begin.body.otpauthUri);
    exchanges.at(-1)!.mayShow = [totpSecret, begin.body.otpauthUri];
    const secret = base32Decode(totpSecret);
    const enrolCode = totpCode(secret, totpStep());
    keep(enrolCode);
    const confirm = await send('confirm TOTP enrolment', 'post', '/v1/auth/mfa/totp/confirm', {
      body: { code: enrolCode },
      jar: enrolling,
    });
    const recoveryCodes = confirm.body.recoveryCodes as string[];
    keep(...recoveryCodes);
    exchanges.at(-1)!.mayShow = recoveryCodes;

    const second: Jar = {};
    await send('platform login (MFA)', 'post', '/v1/auth/login', {
      body: { email: admin, password: p1, audience: 'platform' },
      jar: second,
    });
    const loginCode = totpCode(secret, totpStep() + 1);
    keep(loginCode);
    await send('MFA verify, wrong code', 'post', '/v1/auth/mfa/verify', {
      body: { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' },
      jar: { [MFA_CHALLENGE_COOKIE]: second[MFA_CHALLENGE_COOKIE] },
    });
    await send('MFA verify', 'post', '/v1/auth/mfa/verify', {
      body: { code: loginCode },
      jar: { [MFA_CHALLENGE_COOKIE]: second[MFA_CHALLENGE_COOKIE] },
    });
    const third: Jar = {};
    await send('platform login (recovery)', 'post', '/v1/auth/login', {
      body: { email: admin, password: p1, audience: 'platform' },
      jar: third,
    });
    await send('MFA verify, recovery code', 'post', '/v1/auth/mfa/verify', {
      body: { recoveryCode: recoveryCodes[0] },
      jar: { [MFA_CHALLENGE_COOKIE]: third[MFA_CHALLENGE_COOKIE] },
    });

    // P4.2 — the owner also works at a second business: login (409 + challenge) → choices → select
    const secondOwner = `sweep-second-${randomBytes(5).toString('hex')}@example.test`;
    await send('signup (second business)', 'post', '/v1/auth/signup', {
      body: { email: secondOwner, password: p1, businessName: 'Sweep Two Ltd' },
    });
    await send('verify email (second business)', 'post', '/v1/auth/email/verify', {
      body: { token: await linkToken(secondOwner, 'email_verification') },
    });
    const [ownerRow] = await migrator.query<{ id: string }>(
      `SELECT id FROM identity.identities WHERE email = $1`,
      [owner],
    );
    const ownerIdentity = ownerRow!.id;
    await migrator.query(
      `INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind)
       SELECT mm.merchant_id, $1, 'staff' FROM tenancy.merchant_memberships mm
         JOIN identity.identities i ON i.id = mm.identity_id WHERE i.email = $2`,
      [ownerIdentity, secondOwner],
    );
    const selecting: Jar = {};
    await send('login (membership selection required)', 'post', '/v1/auth/login', {
      body: { email: owner, password: p3, audience: 'merchant' },
      jar: selecting,
    });
    const listed = await send('list login memberships', 'get', '/v1/auth/login/memberships', {
      jar: { [SELECTION_CHALLENGE_COOKIE]: selecting[SELECTION_CHALLENGE_COOKIE] },
    });
    await send('select login membership', 'post', '/v1/auth/login/select', {
      body: { selectionId: listed.body.memberships[0].selectionId },
      jar: { [SELECTION_CHALLENGE_COOKIE]: selecting[SELECTION_CHALLENGE_COOKIE] },
    });

    // the journeys themselves worked (so the sweep below saw real secrets)
    const failedUnexpectedly = exchanges.filter(
      (e) => e.res.status >= 400 && !/wrong|invalid|selection required/.test(e.label),
    );
    expect(
      failedUnexpectedly.map((e) => `${e.label}: ${e.res.status} ${JSON.stringify(e.res.body)}`),
    ).toEqual([]);
    expect(secrets.size).toBeGreaterThan(30);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the last emails' log lines land
  });

  it('no response body or non-cookie header carries a secret, beyond the two shown-once enrolment answers', () => {
    const leaks: string[] = [];
    for (const { label, res, mayShow = [] } of exchanges) {
      const { 'set-cookie': _cookies, ...headers } = res.headers;
      const visible = `${JSON.stringify(res.body)} ${JSON.stringify(headers)}`;
      for (const s of secrets) {
        if (!mayShow.includes(s) && visible.includes(s)) leaks.push(`${label}: ${s.slice(0, 6)}…`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('no log line carries a secret', () => {
    expect(lines.length).toBeGreaterThan(exchanges.length); // request logs + email logs were captured
    const leaks: string[] = [];
    for (const line of lines) {
      // Drop fields that are numbers by nature, so a 6-digit code cannot match a timestamp or a duration.
      const { time: _t, pid: _p, responseTime: _r, ...rest } = JSON.parse(line) as Record<string, unknown>;
      const text = JSON.stringify(rest);
      for (const s of secrets) {
        const hit = /^\d{6}$/.test(s) ? new RegExp(`(^|\\D)${s}(\\D|$)`).test(text) : text.includes(s);
        if (hit) leaks.push(`${s.slice(0, 6)}… in: ${text.slice(0, 160)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('every state-changing auth request was audited, and no audit row carries a secret', async () => {
    const audited = exchanges.filter((e) => e.audited);
    const rows = await migrator.query<{ request_id: string; row: string }>(
      `SELECT request_id, row_to_json(a)::text AS row FROM audit.audit_events a WHERE request_id = ANY($1)`,
      [audited.map((e) => e.res.headers['x-request-id'])],
    );
    const withAudit = new Set(rows.map((r) => r.request_id));
    expect(audited.filter((e) => !withAudit.has(e.res.headers['x-request-id']!)).map((e) => e.label)).toEqual(
      [],
    );

    const leaks = rows.flatMap((r) =>
      [...secrets].filter((s) => r.row.includes(s)).map((s) => `${s.slice(0, 6)}…`),
    );
    expect(leaks).toEqual([]);
  });
});
