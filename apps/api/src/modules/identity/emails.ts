import type { EmailMessage } from '../../platform/email.js';

// Identity emails. Single-use tokens travel in the URL fragment (#token=…): browsers never send the fragment to
// a server, so the token stays out of web-server access logs, proxies and Referer headers. The web page reads it
// and POSTs it to the API.

export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60; // D12

export function verificationEmail(to: string, webAppUrl: string, rawToken: string): EmailMessage {
  const link = `${webAppUrl}/verify-email#token=${rawToken}`;
  return {
    template: 'email_verification',
    to,
    subject: 'Confirm your email address for AlphaKolect',
    text: [
      'Welcome to AlphaKolect.',
      '',
      'Confirm your email address to activate your business account:',
      link,
      '',
      'This link works once and expires in 24 hours.',
      'If you did not sign up for AlphaKolect, you can ignore this email.',
    ].join('\n'),
  };
}
