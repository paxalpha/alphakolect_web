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

export const PASSWORD_RESET_TTL_SECONDS = 30 * 60; // §3.2
export const ACCOUNT_SETUP_TTL_SECONDS = 24 * 60 * 60; // D9 (option A, 2026-10-04)

export function passwordResetEmail(to: string, webAppUrl: string, rawToken: string): EmailMessage {
  return {
    template: 'password_reset',
    to,
    subject: 'Reset your AlphaKolect password',
    text: [
      'Someone asked to reset the password of your AlphaKolect account.',
      '',
      'Choose a new password here:',
      `${webAppUrl}/reset-password#token=${rawToken}`,
      '',
      'This link works once and expires in 30 minutes. Resetting signs you out everywhere.',
      'If you did not ask for this, ignore this email: your password stays the same.',
    ].join('\n'),
  };
}

export function accountSetupEmail(to: string, webAppUrl: string, rawToken: string): EmailMessage {
  return {
    template: 'account_setup',
    to,
    subject: 'Set up your AlphaKolect account',
    text: [
      'An AlphaKolect account has been created for this email address.',
      '',
      'Choose your password to finish setting it up:',
      `${webAppUrl}/set-password#token=${rawToken}`,
      '',
      'This link works once and expires in 24 hours.',
      'If you did not expect this, ignore this email and tell your AlphaKolect contact.',
    ].join('\n'),
  };
}
