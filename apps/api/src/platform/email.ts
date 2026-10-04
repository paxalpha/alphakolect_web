import type { Logger } from 'pino';

// Outgoing email (ADR-14 D1): an EmailSender port with an SMTP adapter (Mailpit locally, smtp-email-sender.ts)
// and an in-memory adapter for tests. An outbox, a worker and a transactional provider are P12 (§14, ADR-9).

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Names the kind of message in logs, e.g. 'email_verification'. Logs never contain the body. */
  template: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Test adapter: keeps every message in memory. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Messages sent to an address, oldest first. */
  to(address: string): EmailMessage[] {
    return this.sent.filter((m) => m.to.toLowerCase() === address.toLowerCase());
  }
}

/**
 * Hands messages to the sender outside the request (D1): callers dispatch only after their database work has
 * committed, the response does not wait for — or reveal the outcome of — delivery (so "new account" and
 * "existing account" take the same time, D12), and a failure is logged without the message body (which may
 * hold a single-use link). Delivery is best effort until the P12 outbox: the user can ask again (resend, forgot).
 */
export class Mailer {
  constructor(
    private readonly sender: EmailSender,
    private readonly logger: Logger,
  ) {}

  dispatch(message: EmailMessage): void {
    setImmediate(() => {
      this.sender.send(message).then(
        () => this.logger.info({ template: message.template }, 'Email sent'),
        (err: unknown) =>
          this.logger.error(
            { template: message.template, error: err instanceof Error ? err.name : 'unknown' },
            'Email delivery failed',
          ),
      );
    });
  }
}
