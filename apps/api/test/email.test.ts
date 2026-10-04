import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEmailSender, Mailer, type EmailMessage } from '../src/platform/email.js';

// The email port (ADR-14 D1): delivery outside the request, and logs that never carry a message body.

const SECRET_LINK = 'https://app.example.test/verify-email#token=do-not-log-this-token-value-aaaaaaaaaaaa';
const message: EmailMessage = {
  template: 'email_verification',
  to: 'someone@example.test',
  subject: 'Confirm',
  text: `Click ${SECRET_LINK}`,
};

function capturingLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

describe('Mailer', () => {
  it('returns before delivery and delivers afterwards', async () => {
    const sender = new InMemoryEmailSender();
    const { logger } = capturingLogger();
    new Mailer(sender, logger).dispatch(message);
    expect(sender.sent).toHaveLength(0);
    await vi.waitFor(() => expect(sender.sent).toEqual([message]));
  });

  it('logs a delivery failure with the template only — never the body, link, address or error text', async () => {
    const { logger, lines } = capturingLogger();
    const failing = {
      send: () => Promise.reject(new Error(`rejected: ${SECRET_LINK} for someone@example.test`)),
    };
    new Mailer(failing, logger).dispatch(message);
    await vi.waitFor(() => expect(lines.join('')).toContain('Email delivery failed'));
    const logged = lines.join('');
    expect(logged).toContain('email_verification');
    expect(logged).not.toContain('do-not-log-this-token-value');
    expect(logged).not.toContain('someone@example.test');
  });

  it('logs a successful delivery without the body or address', async () => {
    const { logger, lines } = capturingLogger();
    new Mailer(new InMemoryEmailSender(), logger).dispatch(message);
    await vi.waitFor(() => expect(lines.join('')).toContain('Email sent'));
    expect(lines.join('')).not.toContain('do-not-log-this-token-value');
    expect(lines.join('')).not.toContain('someone@example.test');
  });
});
