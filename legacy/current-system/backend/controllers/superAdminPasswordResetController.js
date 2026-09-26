const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { Op } = require('sequelize');
const { SuperAdmin, SuperAdminPasswordReset, Activity, sequelize } = require('../models');
const { getClientIp } = require('../utils/clientIp');
const { normalizeEmail } = require('../middleware/rateLimit');

// Super Admin password recovery (TARGET_ARCHITECTURE §3.2):
// single-use hashed tokens, 30-minute expiry, generic responses, audit-logged, revokes sessions.
// Deliberately separate from the merchant/collaborator OTP flows.

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const GENERIC_FORGOT_MESSAGE = 'If an account exists, a reset link has been sent';
const INVALID_TOKEN_MESSAGE = 'This reset link is invalid or has expired. Please request a new one.';

// Configure nodemailer from the same SMTP env config as the other controllers
let transporter;
try {
  if (String(process.env.EMAIL_DISABLED || '').toLowerCase() === 'true') {
    transporter = null;
  } else {
    const hasAuth = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT || 25),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: hasAuth ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } : undefined,
      tls: { rejectUnauthorized: false },
    });
  }
} catch (_) {
  transporter = null;
}

const hashToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

// Same rules as the reset form in the admin UI. bcrypt only uses the first 72 bytes.
const validateNewPassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters long';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be at most 72 characters long';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/\d/.test(password)) return 'Password must contain at least one number';
  if (!/[@$!%*?&.#]/.test(password)) return 'Password must contain at least one special character (@$!%*?&.#)';
  return null;
};

// Case-insensitive lookup by email
const findSuperAdminByEmail = (email) =>
  SuperAdmin.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), normalizeEmail(email)),
    order: [['id', 'ASC']],
  });

const sendResetEmail = async (to, resetLink) => {
  if (!transporter) {
    // Never log the link or token here.
    console.warn('[SuperAdminReset] Email disabled or not configured; reset email not sent');
    return false;
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Alphakolect</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Admin Console</p>
        </td></tr>
        <tr><td style="padding:40px 40px 32px;">
          <h2 style="margin:0 0 12px;color:#1e1b4b;font-size:20px;font-weight:600;">Reset your password</h2>
          <p style="margin:0 0 28px;color:#64748b;font-size:15px;line-height:1.6;">We received a request to reset your Alphakolect admin password. This link expires in <strong>30 minutes</strong> and can be used once.</p>
          <p style="margin:0 0 28px;text-align:center;">
            <a href="${resetLink}" style="display:inline-block;background:#4E37FB;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Reset password</a>
          </p>
          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">If you did not request this, you can ignore this email; your password will not change. Resetting your password signs you out everywhere.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} Alphakolect. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@alphakolect.com',
      to,
      subject: 'Reset your Alphakolect admin password',
      text: `We received a request to reset your Alphakolect admin password.\n\nOpen this link within 30 minutes to choose a new password (it can be used once):\n${resetLink}\n\nIf you did not request this, ignore this email.`,
      html: htmlBody,
    });
    return true;
  } catch (err) {
    console.error('[SuperAdminReset] Email sending failed:', err && err.message ? err.message : err);
    return false;
  }
};

// Issue a token and email it. Runs after the HTTP response has been sent.
const processForgotPassword = async (email, ip) => {
  const superAdmin = await findSuperAdminByEmail(email);
  if (!superAdmin) return;

  const appUrl = String(process.env.ADMIN_APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) {
    console.error('[SuperAdminReset] ADMIN_APP_URL is not set; reset email not sent');
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');

  await sequelize.transaction(async (transaction) => {
    // Invalidate any earlier links that were not used yet
    await SuperAdminPasswordReset.update(
      { expiresAt: sequelize.fn('now') },
      { where: { superAdminId: superAdmin.id, usedAt: null, expiresAt: { [Op.gt]: sequelize.fn('now') } }, transaction }
    );
    await SuperAdminPasswordReset.create({
      superAdminId: superAdmin.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestedIp: ip,
    }, { transaction });
    await Activity.create({
      person: 'staff',
      staffId: null,
      action: 'SUPERADMIN_PASSWORD_RESET_REQUESTED',
      details: `Password reset link requested for super admin #${superAdmin.id} from ${ip}`,
    }, { transaction });
  });

  const resetLink = `${appUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendResetEmail(superAdmin.email, resetLink);
  if (!sent) console.error(`[SuperAdminReset] Reset email for super admin #${superAdmin.id} was not delivered`);
};

// POST /superadmin/forgot-password { email }
// Always answers 200 with the same message, and answers before any lookup is done,
// so neither the body nor the timing reveals whether the account exists.
const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const ip = getClientIp(req);

  res.json({ success: true, message: GENERIC_FORGOT_MESSAGE });

  if (!email || email.length > 255) return;
  setImmediate(() => {
    processForgotPassword(email, ip).catch((err) => {
      console.error('[SuperAdminReset] forgot-password processing failed:', err && err.message ? err.message : err);
    });
  });
};

// POST /superadmin/reset-password { token, newPassword }
const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body || {};

  if (typeof token !== 'string' || !token || token.length > 256) {
    return res.status(400).json({ message: INVALID_TOKEN_MESSAGE });
  }
  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    return res.status(422).json({ message: passwordError });
  }

  const ip = getClientIp(req);

  try {
    const superAdminId = await sequelize.transaction(async (transaction) => {
      const resetRow = await SuperAdminPasswordReset.findOne({
        where: {
          tokenHash: hashToken(token),
          usedAt: null,
          expiresAt: { [Op.gt]: sequelize.fn('now') },
        },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!resetRow) return null;

      const superAdmin = await SuperAdmin.findByPk(resetRow.superAdminId, { lock: transaction.LOCK.UPDATE, transaction });
      if (!superAdmin) return null;

      const now = new Date();
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      // passwordChangedAt revokes every JWT issued before now (see middleware/auth.js requireSuperAdmin)
      await superAdmin.update({ password: hashedPassword, passwordChangedAt: now }, { transaction });
      await resetRow.update({ usedAt: now }, { transaction });
      await SuperAdminPasswordReset.update(
        { expiresAt: now },
        { where: { superAdminId: superAdmin.id, usedAt: null, id: { [Op.ne]: resetRow.id } }, transaction }
      );
      await Activity.create({
        person: 'staff',
        staffId: null,
        action: 'SUPERADMIN_PASSWORD_RESET_COMPLETED',
        details: `Password reset completed for super admin #${superAdmin.id} from ${ip}; existing sessions revoked`,
      }, { transaction });

      return superAdmin.id;
    });

    if (!superAdminId) {
      return res.status(400).json({ message: INVALID_TOKEN_MESSAGE });
    }
    return res.json({ success: true, message: 'Your password has been reset. Please log in with your new password.' });
  } catch (err) {
    console.error('[SuperAdminReset] reset-password failed:', err && err.message ? err.message : err);
    return res.status(500).json({ message: 'Could not reset password. Please try again.' });
  }
};

module.exports = {
  forgotPassword,
  resetPassword,
  findSuperAdminByEmail,
  validateNewPassword,
  hashToken,
};
