// Create the first platform super admin (ADR-14 D9, option A). Operator use only.
//
//   pnpm --filter @alphakolect/api admin:bootstrap -- --email admin@example.com [--allow-additional]
//
// Needs DATABASE_MIGRATOR_URL (the migrator role: the API's own role cannot do this) and the email settings
// (SMTP_URL, MAIL_FROM, WEB_APP_URL — local defaults: Mailpit and http://localhost:3000; required in production).
// Prints the outcome only — never the link or its token.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { bootstrapSuperAdmin } from '../src/modules/identity/bootstrap.js';
import { createDb } from '../src/platform/db.js';
import { SmtpEmailSender } from '../src/platform/smtp-email-sender.js';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// pnpm passes the `--` separator through to the script; drop it, or every option would count as positional.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: { email: { type: 'string' }, 'allow-additional': { type: 'boolean', default: false } },
});
const email = z.email().safeParse(values.email);
if (!email.success) fail('Usage: admin:bootstrap -- --email <address> [--allow-additional]');

const production = process.env.NODE_ENV === 'production';
const Env = z.object({
  DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SMTP_URL: production
    ? z.url({ protocol: /^smtps?$/ })
    : z.url({ protocol: /^smtps?$/ }).default('smtp://127.0.0.1:1025'),
  MAIL_FROM: production
    ? z.string().min(3)
    : z.string().min(3).default('AlphaKolect <no-reply@alphakolect.local>'),
  WEB_APP_URL: production
    ? z.url({ protocol: /^https?$/ })
    : z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
});
const env = Env.safeParse(process.env);
if (!env.success) {
  // Names only: values (which may hold credentials) are never printed.
  fail(`Invalid configuration: ${[...new Set(env.error.issues.map((i) => i.path.join('.')))].join(', ')}`);
}

const db = createDb(env.data!.DATABASE_MIGRATOR_URL);
const sender = new SmtpEmailSender(env.data!.SMTP_URL, env.data!.MAIL_FROM);
try {
  const result = await bootstrapSuperAdmin({
    migrator: db,
    sender,
    webAppUrl: new URL(env.data!.WEB_APP_URL).origin,
    email: email.data!,
    allowAdditional: values['allow-additional'] === true,
  });
  if (result.outcome === 'setup_link_not_sent') {
    fail(
      `Super admin created (${result.identityId}), but the set-password email could not be sent (${result.error}).\n` +
        'Fix the email settings, then use "Forgot password" on the web app with this email: it sends a fresh set-password link.',
    );
  }
  process.stdout.write(
    result.outcome === 'setup_link_sent'
      ? `Super admin created (${result.identityId}). A set-password link (valid 24 hours) was emailed to them.\n`
      : `Super admin membership added (${result.identityId}). This account already has a password: they sign in as usual and must set up two-factor authentication.\n`,
  );
} catch (err) {
  // Database refusals (e.g. a super admin already exists) carry safe messages; anything else is summarised.
  const message =
    err instanceof Error && 'code' in err && err.code === '23514' ? err.message : 'see the error name';
  fail(`Bootstrap failed: ${message} (${err instanceof Error ? err.name : 'unknown'})`);
} finally {
  sender.close();
  await db.close();
}
