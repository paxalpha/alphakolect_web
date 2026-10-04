import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './email.js';

// SMTP adapter for the EmailSender port (ADR-14 D1). Locally this is Mailpit (infrastructure/compose.yaml);
// the production provider is chosen in P12. SMTP_URL may hold credentials and is never logged.

export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }

  close(): void {
    this.transport.close();
  }
}
