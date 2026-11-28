import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createWebhookProxy,
  PAYSTACK_SOURCES,
  startupLines,
  WEBHOOK_PATH,
  webhookProxySettings,
} from '../../scripts/webhook-proxy.js';

// The development tunnel's door (plan §16.4 condition 7): only Paystack's notification gets through to the API, with only
// the headers it needs, and everything else is a 404 that never reaches the API.

type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };
let seen: Seen[] = [];
let answer: { status: number; body: string; type?: string } = {
  status: 200,
  body: '{"received":true}',
  type: 'application/json',
};

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );

const api = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    seen.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    res.writeHead(answer.status, answer.type ? { 'content-type': answer.type } : {}).end(answer.body);
  });
});
let proxy: Server;
let proxyUrl: string;
let apiPort: number;

beforeAll(async () => {
  apiPort = await listen(api);
  proxy = createWebhookProxy({ upstream: `http://127.0.0.1:${apiPort}`, maxBytes: 1024 });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});
afterAll(() => {
  api.close();
  proxy.close();
});
beforeEach(() => {
  seen = [];
  answer = { status: 200, body: '{"received":true}', type: 'application/json' };
});

describe('the webhook-only door', () => {
  it('forwards the notification to the API byte for byte, with only the headers the API needs', async () => {
    const body = '{"event":"charge.success",  "data":{"reference":"R1"}}'; // odd spacing: the signature is over these bytes
    const res = await fetch(`${proxyUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': 'a'.repeat(128),
        'paystack-signature': 't=1,v1=whk_1:abc',
        cookie: 'session=do-not-forward',
        authorization: 'Bearer do-not-forward',
        'x-api-key': 'do-not-forward',
        'x-forwarded-for': '203.0.113.9',
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: WEBHOOK_PATH, body });
    expect(seen[0]!.headers['x-paystack-signature']).toBe('a'.repeat(128));
    expect(seen[0]!.headers['paystack-signature']).toBe('t=1,v1=whk_1:abc');
    expect(seen[0]!.headers['content-type']).toBe('application/json');
    for (const name of ['cookie', 'authorization', 'x-api-key'])
      expect(seen[0]!.headers[name]).toBeUndefined();
    // The client address is the tunnel's, as the proxy sees it: a header the sender made up is not passed on.
    expect(seen[0]!.headers['x-forwarded-for']).not.toBe('203.0.113.9');
  });

  it('answers what the API answers: a refusal stays a refusal', async () => {
    answer = { status: 401, body: '{"error":{"code":"UNAUTHENTICATED"}}', type: 'application/json' };
    const res = await fetch(`${proxyUrl}${WEBHOOK_PATH}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNAUTHENTICATED');
  });

  it('every other route and method is a 404 with no body, and the API never hears of it', async () => {
    const tries: Array<[string, string]> = [
      ['GET', WEBHOOK_PATH],
      ['PUT', WEBHOOK_PATH],
      ['DELETE', WEBHOOK_PATH],
      ['OPTIONS', WEBHOOK_PATH],
      ['POST', '/v1/auth/login'],
      ['POST', '/v1/merchant/wallet'],
      ['GET', '/v1/health'],
      ['POST', '/'],
      ['POST', `${WEBHOOK_PATH}/`],
      ['POST', `${WEBHOOK_PATH}?x=1`],
      ['POST', `${WEBHOOK_PATH}/extra`],
      ['POST', '/v1/webhooks/Paystack'],
      ['POST', '/v1/webhooks/transactpay'],
      ['POST', `/${WEBHOOK_PATH}`],
      ['POST', `/v1/webhooks/../auth/login`],
    ];
    for (const [method, path] of tries) {
      const res = await fetch(`${proxyUrl}${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.text(), `${method} ${path}`).toBe('');
    }
    expect(seen).toEqual([]);
  });

  it('refuses a body over its limit, and does not pass it on', async () => {
    const res = await fetch(`${proxyUrl}${WEBHOOK_PATH}`, { method: 'POST', body: 'x'.repeat(2048) }).catch(
      () => null,
    );
    // The connection may be closed before the answer is read: either way nothing reached the API.
    if (res) expect(res.status).toBe(413);
    expect(seen).toEqual([]);
    const ok = await fetch(`${proxyUrl}${WEBHOOK_PATH}`, { method: 'POST', body: 'x'.repeat(1024) });
    expect(ok.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('is a 502 with no body when the API is not there, and rejects an upstream that is not http', async () => {
    const dead = createWebhookProxy({ upstream: 'http://127.0.0.1:1' });
    const port = await listen(dead);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${WEBHOOK_PATH}`, { method: 'POST', body: '{}' });
      expect(res.status).toBe(502);
      expect(await res.text()).toBe('');
    } finally {
      dead.close();
    }
    expect(() => createWebhookProxy({ upstream: 'https://example.com' })).toThrow();
  });

  it('caps what it returns, so an upstream cannot make it relay a large answer', async () => {
    answer = { status: 200, body: 'y'.repeat(10_000), type: 'text/plain' };
    const res = await fetch(`${proxyUrl}${WEBHOOK_PATH}`, { method: 'POST', body: '{}' });
    expect((await res.text()).length).toBe(4096);
  });
});

describe('the source-address list', () => {
  const gated = async (options: { sourceHeader?: string } = {}) => {
    const door = createWebhookProxy({
      upstream: `http://127.0.0.1:${apiPort}`,
      allowedSources: PAYSTACK_SOURCES,
      ...options,
    });
    const port = await listen(door);
    const post = (headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}${WEBHOOK_PATH}`, { method: 'POST', body: '{}', headers });
    return { door, post, port };
  };

  it('the three documented Paystack addresses are the default list', () => {
    expect([...PAYSTACK_SOURCES]).toEqual(['52.31.139.75', '52.49.173.169', '52.214.14.220']);
  });

  it('lets through a notification whose sender, as the tunnel says, is one of them, and no other', async () => {
    const { door, post } = await gated();
    try {
      for (const ip of PAYSTACK_SOURCES)
        expect((await post({ 'cf-connecting-ip': ip })).status, ip).toBe(200);
      expect((await post({ 'cf-connecting-ip': '::ffff:52.31.139.75' })).status).toBe(200);
      expect(seen).toHaveLength(4);
      seen = [];
      for (const ip of [
        '203.0.113.9',
        '52.31.139.76',
        '52.31.139.7',
        '0.0.0.0',
        'unknown',
        '52.31.139.75, 203.0.113.9',
      ])
        expect((await post({ 'cf-connecting-ip': ip })).status, ip).toBe(404);
      // No address at all: not a notification from a tunnel that says who sent it.
      expect((await post({})).status).toBe(404);
      expect((await post({ 'x-forwarded-for': '52.31.139.75' })).status).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      door.close();
    }
  });

  it('with x-forwarded-for, the last entry, which the tunnel added, decides: a sender cannot put a good address first', async () => {
    const { door, post } = await gated({ sourceHeader: 'X-Forwarded-For' });
    try {
      expect((await post({ 'x-forwarded-for': '52.49.173.169' })).status).toBe(200);
      expect((await post({ 'x-forwarded-for': '203.0.113.9, 52.49.173.169' })).status).toBe(200);
      seen = [];
      expect((await post({ 'x-forwarded-for': '52.49.173.169, 203.0.113.9' })).status).toBe(404);
      expect((await post({ 'x-forwarded-for': '52.49.173.169,' })).status).toBe(404);
      expect((await post({ 'cf-connecting-ip': '52.49.173.169' })).status).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      door.close();
    }
  });

  it('answers a wrong route with a 404 whoever sends it', async () => {
    const { door, port } = await gated();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/auth/login`, {
        method: 'POST',
        body: '{}',
        headers: { 'cf-connecting-ip': '52.31.139.75' },
      });
      expect(res.status).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      door.close();
    }
  });
});

describe('the settings the command reads (reviewer, 27 November: the wiring, not only the function)', () => {
  it('with nothing set: port 4001, the API on 4000, Paystack’s three addresses, read from cf-connecting-ip', () => {
    expect(webhookProxySettings({})).toEqual({
      port: 4001,
      upstream: 'http://127.0.0.1:4000',
      allowedSources: ['52.31.139.75', '52.49.173.169', '52.214.14.220'],
      sourceHeader: 'cf-connecting-ip',
    });
    // An empty value is not "none": it is the default list, the safe one.
    expect(webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: '' }).allowedSources).toEqual([
      ...PAYSTACK_SOURCES,
    ]);
    expect(webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: '   ' }).allowedSources).toEqual([
      ...PAYSTACK_SOURCES,
    ]);
  });

  it('`none` switches the list off, and only the exact word does', () => {
    expect(webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: 'none' }).allowedSources).toBeUndefined();
    expect(webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: ' none ' }).allowedSources).toBeUndefined();
    for (const notNone of ['None', 'NONE', 'off', 'false', '0', 'no'])
      expect(() => webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: notNone }), notNone).toThrow(
        /comma list of IP addresses/,
      );
  });

  it('names its own list, with spaces and a trailing comma tolerated, IPv4 and IPv6', () => {
    expect(
      webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: ' 203.0.113.7 , 198.51.100.2,, 2001:db8::1 ,' })
        .allowedSources,
    ).toEqual(['203.0.113.7', '198.51.100.2', '2001:db8::1']);
  });

  it('the header, the port and the API address come from their settings; the header is lower-cased', () => {
    expect(
      webhookProxySettings({
        WEBHOOK_PROXY_SOURCE_HEADER: ' X-Forwarded-For ',
        WEBHOOK_PROXY_PORT: '5001',
        WEBHOOK_PROXY_UPSTREAM: 'http://127.0.0.1:4100',
      }),
    ).toMatchObject({ sourceHeader: 'x-forwarded-for', port: 5001, upstream: 'http://127.0.0.1:4100' });
  });

  it('refuses what it cannot use, and the message never repeats the value', () => {
    const bad: Array<[Record<string, string>, RegExp]> = [
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: 'not-an-ip-zz9' }, /IP addresses/],
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: '999.1.1.1' }, /IP addresses/],
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: '52.31.139.75, nope-zz9' }, /IP addresses/],
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: ',' }, /IP addresses/],
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: 'http://52.31.139.75' }, /IP addresses/],
      [{ WEBHOOK_PROXY_ALLOWED_SOURCES: '52.31.139.75/24' }, /IP addresses/],
      [{ WEBHOOK_PROXY_SOURCE_HEADER: 'bad header zz9' }, /header name/],
      [{ WEBHOOK_PROXY_SOURCE_HEADER: 'a:b' }, /header name/],
      [{ WEBHOOK_PROXY_PORT: '0' }, /port number/],
      [{ WEBHOOK_PROXY_PORT: '70000' }, /port number/],
      [{ WEBHOOK_PROXY_PORT: 'zz9' }, /port number/],
      [{ WEBHOOK_PROXY_PORT: '40.5' }, /port number/],
    ];
    for (const [env, message] of bad) {
      let error: Error | undefined;
      try {
        webhookProxySettings(env);
      } catch (err) {
        error = err as Error;
      }
      expect(error, JSON.stringify(env)).toBeDefined();
      expect(error!.message).toMatch(message);
      expect(error!.message).not.toContain('zz9');
      expect(error!.message).not.toContain('999.1.1.1');
    }
  });

  it('the startup lines say the list is on, with the list and the header in force; or warn that it is off', () => {
    const on = startupLines(webhookProxySettings({}));
    expect(on[0]).toBe(
      `Forwarding POST ${WEBHOOK_PATH} from 127.0.0.1:4001 to http://127.0.0.1:4000; every other request is a 404.`,
    );
    expect(on[1]).toBe(
      'Source list ON: only 52.31.139.75, 52.49.173.169, 52.214.14.220, as read from the cf-connecting-ip header the tunnel sets.',
    );
    const ngrok = startupLines(webhookProxySettings({ WEBHOOK_PROXY_SOURCE_HEADER: 'x-forwarded-for' }));
    expect(ngrok[1]).toContain('x-forwarded-for header');
    const off = startupLines(webhookProxySettings({ WEBHOOK_PROXY_ALLOWED_SOURCES: 'none' }));
    expect(off[1]).toMatch(/^WARNING: the source-address list is switched off/);
    expect(off[1]).not.toContain('Source list ON');
  });
});

describe('the command itself, as an operator runs it', () => {
  const apiDir = fileURLToPath(new URL('../..', import.meta.url));

  async function freePort(): Promise<number> {
    const probe = createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  async function run(env: Record<string, string>, expectStart = true) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/webhook-proxy.ts'], {
      cwd: apiDir,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    const deadline = Date.now() + 30_000;
    while (expectStart ? out.split('\n').filter(Boolean).length < 2 : child.exitCode === null) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { child, exited, output: () => out, errors: () => err };
  }

  const send = (port: number, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}${WEBHOOK_PATH}`, { method: 'POST', body: '{}', headers });

  it(
    'by default it prints that the list is on, lets Paystack’s addresses through and keeps everyone else out',
    { timeout: 60_000 },
    async () => {
      const port = await freePort();
      const door = await run({
        WEBHOOK_PROXY_PORT: String(port),
        WEBHOOK_PROXY_UPSTREAM: `http://127.0.0.1:${apiPort}`,
      });
      try {
        expect(door.output()).toContain(
          'Source list ON: only 52.31.139.75, 52.49.173.169, 52.214.14.220, as read from the cf-connecting-ip header the tunnel sets.',
        );
        seen = [];
        expect((await send(port, { 'cf-connecting-ip': '52.214.14.220' })).status).toBe(200);
        expect(seen).toHaveLength(1);
        expect((await send(port, { 'cf-connecting-ip': '203.0.113.9' })).status).toBe(404);
        expect((await send(port, {})).status).toBe(404);
        expect(seen).toHaveLength(1);
      } finally {
        door.child.kill('SIGKILL');
      }
    },
  );

  it(
    'with the header set to x-forwarded-for it reads that one, and its last entry',
    { timeout: 60_000 },
    async () => {
      const port = await freePort();
      const door = await run({
        WEBHOOK_PROXY_PORT: String(port),
        WEBHOOK_PROXY_UPSTREAM: `http://127.0.0.1:${apiPort}`,
        WEBHOOK_PROXY_SOURCE_HEADER: 'X-Forwarded-For',
      });
      try {
        expect(door.output()).toContain('as read from the x-forwarded-for header');
        seen = [];
        expect((await send(port, { 'x-forwarded-for': '203.0.113.9, 52.31.139.75' })).status).toBe(200);
        expect((await send(port, { 'x-forwarded-for': '52.31.139.75, 203.0.113.9' })).status).toBe(404);
        expect((await send(port, { 'cf-connecting-ip': '52.31.139.75' })).status).toBe(404);
      } finally {
        door.child.kill('SIGKILL');
      }
    },
  );

  it(
    'with `none` it warns on its first lines, and then no source is refused: the case D2a must not run in',
    { timeout: 60_000 },
    async () => {
      const port = await freePort();
      const door = await run({
        WEBHOOK_PROXY_PORT: String(port),
        WEBHOOK_PROXY_UPSTREAM: `http://127.0.0.1:${apiPort}`,
        WEBHOOK_PROXY_ALLOWED_SOURCES: 'none',
      });
      try {
        expect(door.output()).toContain('WARNING: the source-address list is switched off');
        expect(door.output()).not.toContain('Source list ON');
        seen = [];
        expect((await send(port, { 'cf-connecting-ip': '203.0.113.9' })).status).toBe(200);
      } finally {
        door.child.kill('SIGKILL');
      }
    },
  );

  it(
    'a list that names something that is not an address stops it at start, and says so without the value',
    { timeout: 60_000 },
    async () => {
      const door = await run(
        { WEBHOOK_PROXY_ALLOWED_SOURCES: 'not-an-ip-zz9', WEBHOOK_PROXY_PORT: '4999' },
        false,
      );
      expect(await door.exited).toBe(1);
      expect(door.errors()).toContain(
        'WEBHOOK_PROXY_ALLOWED_SOURCES must be a comma list of IP addresses, or none',
      );
      expect(door.errors()).toContain('Refusing to start.');
      expect(door.errors()).not.toContain('zz9');
      expect(door.output()).toBe('');
    },
  );
});
