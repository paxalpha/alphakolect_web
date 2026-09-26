import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/platform/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: createLogger({ logLevel: 'info' }, stream) };
}

describe('logger redaction', () => {
  it('redacts credentials and financial identifiers', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        body: { email: 'a@example.test', password: 'p4ss', otp: '123456', accountNumber: '0123456789' },
        session: { token: 'tok', refreshToken: 'rt' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
      },
      'event',
    );
    const out = lines.join('');
    for (const secret of ['p4ss', '123456', '0123456789', 'Bearer abc', 'sid=1', '"tok"', '"rt"']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('a@example.test');
    expect(out).toContain('[REDACTED]');
  });
});
