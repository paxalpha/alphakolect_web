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

export const INVITATION_TTL_SECONDS = 24 * 60 * 60; // ADR-15 T10 (P3's account-setup cap)

/** A new person (no password yet): the P3 setup page; finishing it joins the business (ADR-15 T10). */
export function invitationSetupEmail(
  to: string,
  webAppUrl: string,
  rawSetupToken: string,
  businessName: string,
): EmailMessage {
  return {
    template: 'invitation_setup',
    to,
    subject: `You have been invited to ${businessName} on AlphaKolect`,
    text: [
      `${businessName} has invited you to join them on AlphaKolect.`,
      '',
      'Choose your password to create your account and join:',
      `${webAppUrl}/set-password#token=${rawSetupToken}`,
      '',
      'This link works once and expires in 24 hours.',
      'If you did not expect this, ignore this email.',
    ].join('\n'),
  };
}

/** An existing account: the invitation link, accepted with that account's password (ADR-15 T11). */
export function invitationAcceptEmail(
  to: string,
  webAppUrl: string,
  rawInvitationToken: string,
  businessName: string,
): EmailMessage {
  return {
    template: 'invitation_accept',
    to,
    subject: `You have been invited to ${businessName} on AlphaKolect`,
    text: [
      `${businessName} has invited you to join them on AlphaKolect.`,
      '',
      'Accept with your AlphaKolect email and password:',
      `${webAppUrl}/accept-invitation#token=${rawInvitationToken}`,
      '',
      'This link works once and expires in 24 hours.',
      'If you did not expect this, ignore this email.',
    ].join('\n'),
  };
}
