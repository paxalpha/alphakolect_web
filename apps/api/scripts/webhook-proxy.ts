// A webhook-only door for a development tunnel (P9 plan §16.4 condition 7; docs/architecture/P9_LOCAL_READINESS_REPORT.md).
//
// A tunnel (cloudflared, ngrok) exposes whatever it points at. Pointed at the API, it would expose every route to the internet. Point
// it at this proxy instead: it forwards one thing, POST /v1/webhooks/paystack, to the API, and answers 404 with no body to
// everything else, so nothing but Paystack's notification can get through. It forwards only the headers that notification
// needs (never a cookie or an authorization header), refuses a body over 64 KiB, and keeps no state and logs no body.
//
//   pnpm --filter @alphakolect/api webhook:proxy                  # listens on 127.0.0.1:4001, forwards to http://127.0.0.1:4000
//   cloudflared tunnel --url http://127.0.0.1:4001                # the tunnel points here, never at the API
//
// Environment: WEBHOOK_PROXY_PORT (4001), WEBHOOK_PROXY_UPSTREAM (http://127.0.0.1:4000), WEBHOOK_PROXY_ALLOWED_SOURCES (Paystack's three,
// or a comma list, or `none`), WEBHOOK_PROXY_SOURCE_HEADER (cf-connecting-ip). It listens on loopback only.
// It checks no signature: the API does, on the exact bytes it is given, which this proxy forwards unchanged.
//
// It also keeps a list of the addresses a notification may come from: Paystack's three documented ones (52.31.139.75, 52.49.173.169,
// 52.214.14.220). The door sees the tunnel's address, so the original sender's is read from the header the tunnel sets
// (WEBHOOK_PROXY_SOURCE_HEADER: `cf-connecting-ip` for cloudflared, the default; `x-forwarded-for` for ngrok, where the LAST entry is
// the one the tunnel added and the earlier ones are the sender's to make up). A request with no such header, or from any other address,
// is a 404 like everything else. This is a second wall, not the first: the signature is what proves a notification is Paystack's.
// WEBHOOK_PROXY_ALLOWED_SOURCES=none switches the list off, and says so when it starts.
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

export const WEBHOOK_PATH = '/v1/webhooks/paystack';
/** Paystack's documented webhook source addresses (https://paystack.com/docs/payments/webhooks/, read 19 November 2026). */
export const PAYSTACK_SOURCES = ['52.31.139.75', '52.49.173.169', '52.214.14.220'] as const;
/** The only request headers that cross: what the API needs to check the signature and read the body. */
const FORWARDED_HEADERS = [
  'content-type',
  'x-paystack-signature',
  'paystack-signature',
  'user-agent',
] as const;

export type WebhookProxyOptions = Readonly<{
  /** The API, as an http URL, e.g. http://127.0.0.1:4000. */
  upstream: string;
  path?: string;
  maxBytes?: number;
  timeoutMs?: number;
  /** The addresses a notification may come from. Absent: no check (a test, or the explicit "none"). */
  allowedSources?: readonly string[];
  /** The request header the tunnel puts the sender's address in. `x-forwarded-for` is read from its last entry. */
  sourceHeader?: string;
}>;

/** The sender's address as the tunnel reports it, or undefined: one value, an IPv4-mapped IPv6 prefix removed. */
function senderOf(req: IncomingMessage, header: string): string | undefined {
  const raw = req.headers[header];
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const entries = header === 'x-forwarded-for' ? value.split(',') : [value];
  return entries[entries.length - 1]!.trim().replace(/^::ffff:/i, '');
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve('too_large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createWebhookProxy(options: WebhookProxyOptions): Server {
  const upstream = new URL(options.upstream);
  if (upstream.protocol !== 'http:') throw new Error('The upstream must be an http:// URL');
  const path = options.path ?? WEBHOOK_PATH;
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const allowed = options.allowedSources ? new Set(options.allowedSources) : null;
  const sourceHeader = (options.sourceHeader ?? 'cf-connecting-ip').toLowerCase();

  return createServer((req, res) => {
    // Exact method and exact path, no query: anything else does not exist here.
    if (req.method !== 'POST' || req.url !== path) {
      res.writeHead(404).end();
      return;
    }
    if (allowed) {
      const sender = senderOf(req, sourceHeader);
      if (sender === undefined || !allowed.has(sender)) {
        res.writeHead(404).end();
        return;
      }
    }
    readBody(req, maxBytes).then(
      (body) => {
        if (body === 'too_large') {
          res.writeHead(413, { connection: 'close' }).end();
          return;
        }
        const headers: Record<string, string> = { 'content-length': String(body.length) };
        for (const name of FORWARDED_HEADERS) {
          const value = req.headers[name];
          if (typeof value === 'string') headers[name] = value;
        }
        // The API reads the client address from this, from a proxy it trusts (loopback): the tunnel's, which is all we know.
        headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';
        const out = httpRequest(
          {
            hostname: upstream.hostname,
            port: upstream.port,
            path,
            method: 'POST',
            headers,
            timeout: timeoutMs,
          },
          (answer) => {
            const chunks: Buffer[] = [];
            answer.on('data', (chunk: Buffer) => chunks.push(chunk));
            answer.on('end', () => {
              const reply = Buffer.concat(chunks).subarray(0, 4096);
              const type = answer.headers['content-type'];
              res
                .writeHead(answer.statusCode ?? 502, {
                  ...(typeof type === 'string' ? { 'content-type': type } : {}),
                  'content-length': String(reply.length),
                })
                .end(reply);
            });
          },
        );
        out.on('timeout', () => out.destroy());
        out.on('error', () => {
          if (!res.headersSent) res.writeHead(502).end();
        });
        out.end(body);
      },
      () => {
        if (!res.headersSent) res.writeHead(400).end();
      },
    );
  });
}

export type WebhookProxySettings = Readonly<{
  port: number;
  upstream: string;
  /** Undefined only when the operator said `none`. */
  allowedSources: readonly string[] | undefined;
  sourceHeader: string;
}>;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;
const looksLikeAddress = (value: string): boolean => {
  const v4 = IPV4.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(':') && IPV6.test(value);
};

/**
 * What the command reads from its environment: the port, the API's address, the list of source addresses (Paystack's three unless the
 * operator names others, or says `none`) and the header the tunnel puts the sender in. Anything unusable stops the start with a message
 * that never repeats the value: a list that names something that is not an address would otherwise silently let nothing, or everything, in.
 */
export function webhookProxySettings(
  env: Readonly<Record<string, string | undefined>>,
): WebhookProxySettings {
  const port = Number(env.WEBHOOK_PROXY_PORT ?? 4001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('WEBHOOK_PROXY_PORT must be a port number from 1 to 65535');
  const upstream = env.WEBHOOK_PROXY_UPSTREAM ?? 'http://127.0.0.1:4000';
  const header = (env.WEBHOOK_PROXY_SOURCE_HEADER ?? 'cf-connecting-ip').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(header)) throw new Error('WEBHOOK_PROXY_SOURCE_HEADER must be a header name');
  const listed = env.WEBHOOK_PROXY_ALLOWED_SOURCES?.trim();
  if (listed === 'none') return { port, upstream, allowedSources: undefined, sourceHeader: header };
  if (!listed) return { port, upstream, allowedSources: [...PAYSTACK_SOURCES], sourceHeader: header };
  const sources = listed
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (sources.length === 0 || !sources.every(looksLikeAddress))
    throw new Error('WEBHOOK_PROXY_ALLOWED_SOURCES must be a comma list of IP addresses, or none');
  return { port, upstream, allowedSources: sources, sourceHeader: header };
}

/** The two lines the door prints when it starts: where it forwards, and whether the source list is on, with the list and the header in force. */
export function startupLines(settings: WebhookProxySettings): string[] {
  return [
    `Forwarding POST ${WEBHOOK_PATH} from 127.0.0.1:${settings.port} to ${settings.upstream}; every other request is a 404.`,
    settings.allowedSources
      ? `Source list ON: only ${settings.allowedSources.join(', ')}, as read from the ${settings.sourceHeader} header the tunnel sets.`
      : 'WARNING: the source-address list is switched off (WEBHOOK_PROXY_ALLOWED_SOURCES=none): the signature is the only check on who sent a notification.',
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let settings: WebhookProxySettings;
  try {
    settings = webhookProxySettings(process.env);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : 'Unusable settings'}\nRefusing to start.\n`);
    process.exit(1);
  }
  const server = createWebhookProxy({
    upstream: settings.upstream,
    ...(settings.allowedSources ? { allowedSources: settings.allowedSources } : {}),
    sourceHeader: settings.sourceHeader,
  });
  server.listen(settings.port, '127.0.0.1', () => {
    for (const line of startupLines(settings)) process.stdout.write(`${line}\n`);
  });
}
