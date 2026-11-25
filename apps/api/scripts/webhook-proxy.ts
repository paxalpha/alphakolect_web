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
// Environment: WEBHOOK_PROXY_PORT (4001), WEBHOOK_PROXY_UPSTREAM (http://127.0.0.1:4000). It listens on loopback only.
// It checks no signature: the API does, on the exact bytes it is given, which this proxy forwards unchanged.
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

export const WEBHOOK_PATH = '/v1/webhooks/paystack';
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
}>;

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

  return createServer((req, res) => {
    // Exact method and exact path, no query: anything else does not exist here.
    if (req.method !== 'POST' || req.url !== path) {
      res.writeHead(404).end();
      return;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.WEBHOOK_PROXY_PORT ?? 4001);
  const upstream = process.env.WEBHOOK_PROXY_UPSTREAM ?? 'http://127.0.0.1:4000';
  const server = createWebhookProxy({ upstream });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `Forwarding POST ${WEBHOOK_PATH} from 127.0.0.1:${port} to ${upstream}; every other request is a 404.\n`,
    );
  });
}
