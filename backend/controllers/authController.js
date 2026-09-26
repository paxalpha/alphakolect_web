const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { Op } = require("sequelize");
const { Merchant } = require("../models");

/* Swagger documentation for Merchant Auth intentionally removed from Swagger UI */

// Configure nodemailer — uses localhost Exim relay (no auth) by default
let transporter;
try {
  if (String(process.env.EMAIL_DISABLED || "").toLowerCase() === "true") {
    transporter = null;
  } else {
    const smtpHost = process.env.SMTP_HOST || 'localhost';
    const smtpPort = Number(process.env.SMTP_PORT || 25);
    const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const hasAuth = process.env.EMAIL_USER && process.env.EMAIL_PASS;

    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: hasAuth
        ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        : undefined,
      tls: { rejectUnauthorized: false },
      // NOTE: requireTLS intentionally removed — breaks localhost:25 relay
    });
  }
} catch (_) {
  transporter = null;
}

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email with Alphakolect HTML branding
const sendOTPEmail = async (email, otp) => {
  if (!transporter) {
    console.warn('Email not configured. OTP:', otp, 'Recipient:', email);
    return { sent: false, reason: 'disabled_or_not_configured' };
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Alphakolect</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Merchant Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px 40px 32px;">
          <h2 style="margin:0 0 12px;color:#1e1b4b;font-size:20px;font-weight:600;">Verify Your Email Address</h2>
          <p style="margin:0 0 28px;color:#64748b;font-size:15px;line-height:1.6;">Use the one-time code below to complete your registration. This code expires in <strong>10 minutes</strong>.</p>
          <!-- OTP Box -->
          <div style="background:#f0f4ff;border:2px dashed #4f46e5;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
            <p style="margin:0 0 6px;color:#64748b;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Your OTP Code</p>
            <p style="margin:0;color:#4f46e5;font-size:42px;font-weight:700;letter-spacing:10px;font-family:monospace;">${otp}</p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">If you did not create an account on Alphakolect, please ignore this email. Do not share this code with anyone.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} Alphakolect. All rights reserved.</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;"><a href="https://alphakolect.com" style="color:#4f46e5;text-decoration:none;">alphakolect.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@alphakolect.com',
    to: email,
    subject: `${otp} is your Alphakolect verification code`,
    text: `Your Alphakolect OTP is: ${otp}. It will expire in 10 minutes. Do not share this code with anyone.`,
    html: htmlBody,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent to:', email, '| MessageId:', info.messageId);
    return { sent: true, info };
  } catch (err) {
    console.error('Email sending failed:', err && err.message ? err.message : err);
    return { sent: false, error: err };
  }
};

// Register merchant
const registerMerchant = async (req, res) => {
  try {
    const { businessName, businessAlias, phone, email, currency, password } =
      req.body;

    // Check if merchant already exists
    const existingMerchant = await Merchant.findOne({ where: { email } });
    if (existingMerchant) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log('=== Registration OTP Debug ===');
    console.log('Generated OTP:', otp);
    console.log('OTP Expires:', otpExpires.toISOString());
    console.log('Email:', email);

    const planId = req.body.planId || req.body.plan_id || 1;
    const trialDays = 90;
    const trialEndDate = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    // Create merchant
    const merchant = await Merchant.create({
      name: businessName,
      businessName,
      businessAlias,
      phone,
      email,
      currency,
      password: hashedPassword,
      otp,
      otpExpires,
      plan_id: planId,
      subscription_status: 'Active',
      trial_end_date: trialEndDate,
      next_billing_date: trialEndDate,
    });

    console.log('Merchant created with ID:', merchant.id);

    // Create Virtual Account via TransactPay — uses businessAlias as the unique TP alias
    try {
        const { createVirtualAccount } = require('../utils/transactPay');
        // Use "AK-{id}-{businessAlias}" as alias so it's guaranteed unique per merchant
        const tpAlias = `AK-${merchant.id}-${(businessAlias || '').replace(/\s+/g, '-').substring(0, 20)}`;
        console.log(`[Auth] Provisioning TransactPay VA for merchant ${merchant.id} with alias: ${tpAlias}`);

        const tpResult = await createVirtualAccount({ alias: tpAlias });

        if (tpResult && tpResult.status === 'success') {
            await merchant.update({
                accountNumber: tpResult.accountNumber,
                bankName: tpResult.bankName,
                accountName: businessName,
                bankCode: tpResult.bankCode
            });
            console.log(`[Auth] ✅ Merchant ${merchant.id} provisioned: ${tpResult.accountNumber} @ ${tpResult.bankName}`);
        } else {
            console.warn(`[Auth] ⚠️ TransactPay VA creation did not succeed for merchant ${merchant.id}:`, tpResult?.message);
        }
    } catch (tpError) {
        // VA creation failure must NOT block registration — merchant still gets created
        console.error('[Auth] TransactPay VA Error (non-fatal):', tpError.message || tpError);
    }

    // Try to send OTP email, but don't fail registration if email fails
    const emailResult = await sendOTPEmail(email, otp);
    res.status(201).json({
      message: emailResult.sent
        ? "Merchant registered successfully. Please verify your email with the OTP sent."
        : "Merchant registered successfully. Email not sent; use the OTP below to verify.",
      merchantId: merchant.id,
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Handle Sequelize validation errors
    if (
      error.name === "SequelizeValidationError" ||
      error.name === "SequelizeUniqueConstraintError"
    ) {
      const errors = error.errors
        ? error.errors.map((e) => ({
            field: e.path,
            message: e.message,
            value: e.value,
          }))
        : [];

      return res.status(400).json({
        message: "Validation failed",
        errors,
        details: error.message,
      });
    }

    res
      .status(500)
      .json({ message: "Registration failed", error: error.message });
  }
};

// Login merchant
const loginMerchant = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find merchant
    const merchant = await Merchant.findOne({ where: { email } });
    if (!merchant) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, merchant.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Enforce email verification before login
    if (!merchant.isVerified) {
      return res
        .status(403)
        .json({ message: "Please verify your email first" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: merchant.id, email: merchant.email, type: "merchant" },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" },
    );

    res.json({
      message: "Login successful",
      token,
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        email: merchant.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed", error: error.message });
  }
};

// Forgot password
const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();

    const merchant = await Merchant.findOne({
      where: { email: { [Op.iLike]: email } },
    });
    if (!merchant) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update merchant with OTP
    await merchant.update({ otp, otpExpires });

    // Send OTP email
    const emailResult = await sendOTPEmail(merchant.email, otp);
    res.json({
      message: emailResult.sent
        ? "OTP sent to your email"
        : "Email not sent; use the OTP shown here",
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ message: "Failed to send OTP", error: error.message });
  }
};

// Resend OTP
const resendOTP = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();

    const merchant = await Merchant.findOne({
      where: { email: { [Op.iLike]: email } },
    });
    if (!merchant) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update merchant with new OTP
    await merchant.update({ otp, otpExpires });

    // Send OTP email
    const emailResult = await sendOTPEmail(merchant.email, otp);
    res.json({
      message: emailResult.sent
        ? "OTP resent to your email"
        : "Email not sent; use the OTP shown here",
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res
      .status(500)
      .json({ message: "Failed to resend OTP", error: error.message });
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || "").trim();
    const otp = String((req.body && req.body.otp) || "").trim();

    console.log("=== OTP Verification Debug ===");
    console.log("Received email:", email);
    console.log("Received OTP:", otp);
    console.log("Request body:", JSON.stringify(req.body));

    const merchant = await Merchant.findOne({
      where: { email: { [Op.iLike]: email } },
    });
    if (!merchant) {
      console.log("Merchant not found for email:", email);
      return res.status(404).json({ message: "Email not found" });
    }

    console.log("Merchant found:", {
      id: merchant.id,
      email: merchant.email,
      isVerified: merchant.isVerified,
      storedOtp: merchant.otp,
      otpExpires: merchant.otpExpires,
    });

    // Normalize OTP values and reliably check expiration
    const providedOtp = String(otp || "").trim();
    const storedOtp = String(merchant.otp || "").trim();
    const now = new Date();
    const expiresAt = merchant.otpExpires
      ? new Date(merchant.otpExpires)
      : null;
    const skipExpiry =
      String(process.env.OTP_SKIP_EXPIRY || "").toLowerCase() === "true";
    const graceMs = Number(process.env.OTP_GRACE_MS || 120000);
    const masterOtp = String(process.env.OTP_MASTER || "").trim();

    console.log("OTP Comparison:", {
      providedOtp,
      storedOtp,
      otpMatches: providedOtp === storedOtp,
      now: now.toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      skipExpiry,
      graceMs,
      masterOtp: masterOtp ? "***configured***" : "not set",
    });

    // Allow success if already verified
    if (merchant.isVerified && !storedOtp) {
      console.log("Merchant already verified");
      return res.json({ message: "Email verified successfully" });
    }

    // Accept master OTP if configured
    const otpMatches =
      !!providedOtp &&
      (providedOtp === storedOtp || (masterOtp && providedOtp === masterOtp));
    console.log("OTP matches:", otpMatches);

    if (!otpMatches) {
      console.log("OTP does not match - FAILED");
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (!skipExpiry) {
      if (!expiresAt) {
        console.log("No expiry date set - FAILED");
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
      const isExpired = now.getTime() > expiresAt.getTime() + graceMs;
      console.log("Expiry check:", {
        isExpired,
        timeDiff: now.getTime() - expiresAt.getTime(),
        allowedGrace: graceMs,
      });
      if (isExpired) {
        console.log("OTP expired - FAILED");
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
    } else {
      console.log("Expiry check skipped (OTP_SKIP_EXPIRY=true)");
    }

    console.log("OTP verification successful - updating merchant");
    // Mark email as verified and clear OTP
    await merchant.update({
      isVerified: true,
      otp: null,
      otpExpires: null,
    });

    console.log("Merchant updated successfully");
    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("OTP verification error:", error);
    res
      .status(500)
      .json({ message: "OTP verification failed", error: error.message });
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    console.log("=== Change Password Debug ===");
    console.log("Received email:", email);

    if (!email || !newPassword) {
      return res.status(400).json({ message: "Email and new password are required" });
    }

    const merchant = await Merchant.findOne({
      where: { email: { [Op.iLike]: email } },
    });
    if (!merchant) {
      console.log("Merchant not found for password change:", email);
      return res.status(404).json({ message: "Email not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await merchant.update({ password: hashedPassword });
    console.log("Password updated successfully for merchant:", merchant.id);

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res
      .status(500)
      .json({ message: "Password change failed", error: error.message });
  }
};

// Get merchant profile
const getMerchantProfile = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const merchant = await Merchant.findByPk(merchantId, {
      attributes: { exclude: ["password", "otp", "otpExpires"] },
    });
    if (!merchant) {
      return res.status(404).json({ message: "Merchant not found" });
    }
    res.json({ success: true, merchant });
  } catch (error) {
    console.error("Get merchant profile error:", error);
    res.status(500).json({ message: "Failed to fetch merchant profile", error: error.message });
  }
};

module.exports = {
  registerMerchant,
  loginMerchant,
  getMerchantProfile,
  forgotPassword,
  resendOTP,
  verifyOTP,
  changePassword,
};
