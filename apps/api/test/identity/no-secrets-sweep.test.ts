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
//   - no response body or non-cookie header contains any of them — except the responses whose job is to hand a
//     secret over once, and only that secret: the two enrolment answers (the TOTP secret; the recovery codes) and
//     the agent token responses (bearer tokens travel in bodies by design, ADR-14 D7; P4.7);
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
    bearer,
  }: { body?: object; jar?: Jar; audited?: boolean; mayShow?: string[]; bearer?: string } = {},
): Promise<request.Response> {
  let req = request(app)[method](path).set('X-Forwarded-For', clientIp()).set('Origin', TEST_WEB_ORIGIN);
  if (bearer) req = req.set('Authorization', `Bearer ${bearer}`);
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
      `WITH m AS (SELECT mm.merchant_id FROM tenancy.merchant_memberships mm
                   JOIN identity.identities i ON i.id = mm.identity_id WHERE i.email = $2),
            r AS (INSERT INTO tenancy.roles (merchant_id, name)
                  SELECT m.merchant_id, 'Staff ' || gen_random_uuid() FROM m RETURNING id, merchant_id)
       INSERT INTO tenancy.merchant_memberships (merchant_id, identity_id, kind, role_id)
       SELECT r.merchant_id, $1, 'staff', r.id FROM r`,
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

    // P4.6 — invitations: a new person (setup link) and an existing account (invitation link + password)
    const ownerJar: Jar = {};
    await send('login (second business owner)', 'post', '/v1/auth/login', {
      body: { email: secondOwner, password: p1, audience: 'merchant' },
      jar: ownerJar,
    });
    const newcomer = `sweep-new-${randomBytes(5).toString('hex')}@example.test`;
    await send('invite a new person', 'post', '/v1/merchant/invitations', {
      body: { email: newcomer, kind: 'agent' },
      jar: ownerJar,
    });
    await send('account setup (invitation)', 'post', '/v1/auth/password/setup', {
      body: { token: await linkToken(newcomer, 'invitation_setup'), password: p2 },
    });
    const existing = `sweep-existing-${randomBytes(5).toString('hex')}@example.test`;
    await send('signup (existing account)', 'post', '/v1/auth/signup', {
      body: { email: existing, password: p1, businessName: 'Sweep Three Ltd' },
    });
    await send('verify email (existing account)', 'post', '/v1/auth/email/verify', {
      body: { token: await linkToken(existing, 'email_verification') },
    });
    await send('invite an existing account', 'post', '/v1/merchant/invitations', {
      body: { email: existing, kind: 'agent' },
      jar: ownerJar,
    });
    const invitationToken = await linkToken(existing, 'invitation_accept');
    await send('accept invitation, wrong password', 'post', '/v1/auth/invitations/accept', {
      body: { token: invitationToken, email: existing, password: 'wrong long passphrase' },
    });
    await send('accept invitation', 'post', '/v1/auth/invitations/accept', {
      body: { token: invitationToken, email: existing, password: p1 },
    });

    // P4.7 — the invited agent signs in on the mobile endpoints: login → self → refresh → logout
    const agentLogin = await send('agent login', 'post', '/v1/auth/agent/login', {
      body: { email: newcomer, password: p2 },
    });
    keep(agentLogin.body.accessToken, agentLogin.body.refreshToken);
    exchanges.at(-1)!.mayShow = [agentLogin.body.accessToken, agentLogin.body.refreshToken];
    await send('agent membership', 'get', '/v1/agent/membership', { bearer: agentLogin.body.accessToken });
    const agentRefresh = await send('agent refresh', 'post', '/v1/auth/agent/refresh', {
      body: { refreshToken: agentLogin.body.refreshToken },
    });
    keep(agentRefresh.body.accessToken, agentRefresh.body.refreshToken);
    exchanges.at(-1)!.mayShow = [agentRefresh.body.accessToken, agentRefresh.body.refreshToken];
    await send('agent refresh, reused token', 'post', '/v1/auth/agent/refresh', {
      body: { refreshToken: agentLogin.body.refreshToken },
    });

    // the journeys themselves worked (so the sweep below saw real secrets)
    const failedUnexpectedly = exchanges.filter(
      (e) => e.res.status >= 400 && !/wrong|invalid|selection required|reused/.test(e.label),
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

// ── D9 (P5 plan §8.6, P5.8; R49, R50): no IP address or user agent in a log line, a response or a stored request id ──
// The server as production builds it — its own request ids — with its real logger at trace level. Distinctive
// addresses ride in every header a proxy or client could use, a distinctive user agent in every request, a forged
// X-Request-ID holding an address, and an address in a query string; and a database failure is injected whose message
// and detail print the new session's IP address and user agent. The activity record keeps the IP address and user agent
// (D9); nothing else may.
const d9Lines: string[] = [];
const d9Stream = new Writable({
  write(chunk, _enc, done) {
    d9Lines.push(String(chunk));
    done();
  },
});
const served = await createTestApp({
  serverRequestIds: true,
  logger: createLogger({ logLevel: 'trace' }, d9Stream),
});

describe('no IP address or user agent reaches a log line, a response or a stored request id (D9, §8.6)', () => {
  const octet = () => 1 + (randomBytes(1)[0]! % 250);
  const address = () => `198.18.${octet()}.${octet()}`;
  const v = {
    forwardedFor: address(),
    realIp: address(),
    forwarded: address(),
    cloudflare: address(),
    trueClient: address(),
    custom: address(),
    forgedRequestId: address(),
    query: address(),
    failingIp: address(),
    userAgent: `d9-sweep-agent/${randomBytes(4).toString('hex')}`,
    failingAgent: `d9-failing-agent/${randomBytes(4).toString('hex')}`,
  };
  const values = Object.values(v);
  const responses: request.Response[] = [];
  const headed = (req: request.Test, ip = v.forwardedFor, agent = v.userAgent) =>
    req
      .set('X-Forwarded-For', ip)
      .set('X-Real-IP', v.realIp)
      .set('Forwarded', `for=${v.forwarded}`)
      .set('CF-Connecting-IP', v.cloudflare)
      .set('True-Client-IP', v.trueClient)
      .set('X-Client-Address', v.custom)
      .set('X-Request-ID', v.forgedRequestId)
      .set('User-Agent', agent)
      .set('Origin', TEST_WEB_ORIGIN);
  const keepRes = async (req: request.Test) => {
    const res = await req;
    responses.push(res);
    return res;
  };
  const failSchema = `d9_fail_${randomBytes(4).toString('hex')}`;

  it('sends the journeys: sign-up, verification, sign-in, a session read, a query string, a 404, and a failing sign-in', async () => {
    const who = `d9-sweep-${randomBytes(5).toString('hex')}@example.test`;
    const password = 'a d9 sweep passphrase';
    await keepRes(
      headed(request(served.app).post('/v1/auth/signup')).send({
        email: who,
        password,
        businessName: 'D9 Sweep Ltd',
      }),
    );
    await vi.waitFor(() =>
      expect(served.email.to(who).some((m) => m.template === 'email_verification')).toBe(true),
    );
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(
      served.email.to(who).find((m) => m.template === 'email_verification')!.text,
    )![1]!;
    await keepRes(headed(request(served.app).post('/v1/auth/email/verify')).send({ token }));
    const login = await keepRes(
      headed(request(served.app).post('/v1/auth/login')).send({ email: who, password, audience: 'merchant' }),
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const access = ((login.headers['set-cookie'] as unknown as string[]) ?? [])
      .map((c) => c.split(';')[0]!)
      .find((c) => c.startsWith(`${AUTH_COOKIES.access}=`))!;
    await keepRes(headed(request(served.app).get('/v1/auth/session')).set('Cookie', access));
    await keepRes(headed(request(served.app).get(`/v1/health?addr=${v.query}&agent=${v.userAgent}`)));
    await keepRes(headed(request(served.app).get(`/v1/nowhere?addr=${v.query}`)));

    // A database failure whose message and detail print the new session's IP address and user agent.
    await migrator.query(`CREATE SCHEMA ${failSchema}`);
    try {
      await migrator.query(
        `CREATE FUNCTION ${failSchema}.fail() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW.user_agent = '${v.failingAgent}' THEN
             RAISE EXCEPTION 'session from % with %', NEW.created_ip, NEW.user_agent
               USING ERRCODE = 'XX000', DETAIL = format('Failing row contains (%s, %s)', NEW.created_ip, NEW.user_agent),
                     HINT = NEW.user_agent;
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await migrator.query(
        `CREATE TRIGGER d9_fail BEFORE INSERT ON identity.sessions FOR EACH ROW EXECUTE FUNCTION ${failSchema}.fail()`,
      );
      const failed = await keepRes(
        headed(request(served.app).post('/v1/auth/login'), v.failingIp, v.failingAgent).send({
          email: who,
          password,
          audience: 'merchant',
        }),
      );
      expect(failed.status).toBe(500);
    } finally {
      await migrator.query(`DROP TRIGGER IF EXISTS d9_fail ON identity.sessions`);
      await migrator.query(`DROP SCHEMA ${failSchema} CASCADE`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the last log lines land
  });

  it('the server’s own request id answers every request; the forged one is ignored', () => {
    for (const res of responses) {
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers['x-request-id']).not.toBe(v.forgedRequestId);
    }
  });

  it('no log line carries an address or a user agent — and the failure was logged, by its structure only', () => {
    expect(d9Lines.length).toBeGreaterThan(responses.length);
    const leaks = d9Lines.flatMap((line) =>
      values.filter((value) => line.includes(value)).map((value) => `${value} in ${line.slice(0, 200)}`),
    );
    expect(leaks).toEqual([]);
    // Not vacuous: the injected failure reached the log, as its SQLSTATE and a fixed message.
    const failure = d9Lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => (l.err as { code?: string } | undefined)?.code === 'XX000');
    expect(failure?.err).toMatchObject({
      type: 'DatabaseError',
      message: 'database error XX000',
      code: 'XX000',
      severity: 'ERROR',
    });
    for (const field of ['detail', 'hint', 'where', 'stack']) expect(failure?.err).not.toHaveProperty(field);
    // And a request line is the id, the method and the path — no query string, header or address.
    const lines = d9Lines.map((l) => JSON.parse(l) as { req?: Record<string, unknown> }).filter((l) => l.req);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(Object.keys(l.req!).sort()).toEqual(['id', 'method', 'url']);
  });

  it('no response carries one (beyond what the caller sent: none echoed)', () => {
    const leaks = responses.flatMap((res) => {
      const visible = `${JSON.stringify(res.body)} ${JSON.stringify(res.headers)}`;
      return values.filter((value) => visible.includes(value)).map((value) => `${res.status}: ${value}`);
    });
    expect(leaks).toEqual([]);
  });

  it('no stored request id carries one; the activity record keeps the IP address and user agent (D9)', async () => {
    const ids = responses.map((r) => r.headers['x-request-id']);
    const rows = await migrator.query<{ request_id: string; ip: string | null; user_agent: string | null }>(
      `SELECT request_id, ip, user_agent FROM audit.audit_events WHERE request_id = ANY($1) OR request_id = ANY($2)`,
      [ids, values],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => values.includes(r.request_id))).toEqual([]);
    expect(rows.every((r) => ids.includes(r.request_id))).toBe(true);
    expect(rows.some((r) => r.ip === v.forwardedFor && r.user_agent === v.userAgent)).toBe(true);
  });
});
