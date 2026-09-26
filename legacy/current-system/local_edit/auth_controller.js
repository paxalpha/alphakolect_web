const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { Op } = require("sequelize");
const db = require("../models");
const { Merchant } = db;

/* Swagger documentation for Merchant Auth intentionally removed from Swagger UI */

// Configure nodemailer (env-driven; safe fallback)
let transporter;
// const encodedPass = encodeURIComponent(process.env.EMAIL_PASS);
try {
  if (String(process.env.EMAIL_DISABLED || "").toLowerCase() === "true") {
    transporter = null;
  } else if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth:
        process.env.EMAIL_USER && process.env.EMAIL_PASS
          ? {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS,
            }
          : undefined,
      tls: { rejectUnauthorized: false },
      requireTLS: true,
      debug: true,
    });
  } else {
    // Default to Gmail if specified; otherwise mock
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    } else {
      transporter = null; // mock mode
    }
  }
} catch (_) {
  transporter = null;
}

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp) => {
  if (!transporter) {
    console.warn(
      "Email disabled or not configured. OTP:",
      otp,
      "Recipient:",
      email,
    );
    return { sent: false, reason: "disabled_or_not_configured" };
  }
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Your OTP for AlphaWeb",
    text: `Your OTP is: ${otp}. It will expire in 10 minutes.`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    return { sent: true, info };
  } catch (err) {
    console.error(
      "Email sending failed:",
      err && err.message ? err.message : err,
    );
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

    const trialMonths = parseInt(process.env.TRIAL_MONTHS || "3", 10);
    const trialEndDate = new Date();
    trialEndDate.setMonth(trialEndDate.getMonth() + trialMonths);
    
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
      trialEndDate,
      nextBillingDate: trialEndDate, // first charge is at end of trial
      subscriptionStatus: 'Active',
    });

    console.log('Merchant created with ID:', merchant.id);

    // Create Virtual Account via TransactPay
    try {
        const { createVirtualAccount } = require('../utils/transactPay');
        const tpResult = await createVirtualAccount({
            businessName,
            email,
            phone
        });

        if (tpResult && tpResult.status === 'success') {
            await merchant.update({
                accountNumber: tpResult.accountNumber,
                bankName: tpResult.bankName,
                accountName: tpResult.accountName,
                bankCode: tpResult.bankCode
            });
            console.log(`Updated merchant ${merchant.id} with account: ${tpResult.accountNumber}`);
        }
    } catch (tpError) {
        console.error('Merchant TransactPay Integration Error:', tpError);
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
    const { email } = req.body;

    const merchant = await Merchant.findOne({ where: { email } });
    if (!merchant) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update merchant with OTP
    await merchant.update({ otp, otpExpires });

    // Send OTP email (non-blocking for dev)
    const emailResult = await sendOTPEmail(email, otp);
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
    const { email } = req.body;

    const merchant = await Merchant.findOne({ where: { email } });
    if (!merchant) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update merchant with new OTP
    await merchant.update({ otp, otpExpires });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp);
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
    const { email, newPassword } = req.body;

    const merchant = await Merchant.findOne({ where: { email } });
    if (!merchant) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await merchant.update({ password: hashedPassword });

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
    const merchantId = req.user.id;
    const merchant = await Merchant.findByPk(merchantId, {
      attributes: { exclude: ["password", "otp", "otpExpires"] },
      include: [
        { model: db.Plan, as: 'plan', attributes: ['name', 'pricing'] },
        { model: db.Agent, as: 'agents', attributes: ['id'] }
      ]
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
