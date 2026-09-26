const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Collaborator } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Collaborator Auth
 *     description: Collaborator authentication and management
 * /collaborator/signup:
 *   post:
 *     summary: Register a new collaborator
 *     tags: [Collaborator Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phone, password, role]
 *             properties:
 *               fullName:
 *                 type: string
 *                 description: Full name
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *                 example: "john@alphaweb.com"
 *               phone:
 *                 type: string
 *                 description: Phone number
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Password
 *                 example: "password123"
 *               role:
 *                 type: string
 *                 description: Collaborator role
 *                 example: "Manager"
 *     responses:
 *       201:
 *         description: Collaborator registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Collaborator registered successfully. Please verify your email with the OTP sent."
 *                 collaboratorId:
 *                   type: integer
 *                   example: 1
 *       400:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Email already registered"
 *       500:
 *         description: Registration failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Registration failed"
 *                 error:
 *                   type: string
 *                   example: "Error details"
 * /collaborator/login:
 *   post:
 *     summary: Login collaborator
 *     tags: [Collaborator Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *                 example: "john@alphaweb.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Password
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 collaborator:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     fullName:
 *                       type: string
 *                       example: "John Doe"
 *                     email:
 *                       type: string
 *                       example: "john@alphaweb.com"
 *                     role:
 *                       type: string
 *                       example: "Manager"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid credentials"
 *       403:
 *         description: Email not verified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Please verify your email first"
 *       500:
 *         description: Login failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Login failed"
 *                 error:
 *                   type: string
 *                   example: "Error details"
 * /collaborator/forgot-password:
 *   post:
 *     summary: Request password reset for collaborator
 *     tags: [Collaborator Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *                 example: "john@alphaweb.com"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "OTP sent to your email"
 *       404:
 *         description: Collaborator not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Collaborator not found"
 *       500:
 *         description: Failed to send OTP
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Failed to send OTP"
 * /collaborator/verify-otp:
 *   post:
 *     summary: Verify OTP for collaborator
 *     tags: [Collaborator Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *                 example: "john@alphaweb.com"
 *               otp:
 *                 type: string
 *                 description: OTP code
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "OTP verified successfully"
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid or expired OTP"
 *       500:
 *         description: Verification failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Verification failed"
 * /collaborator/change-password:
 *   post:
 *     summary: Change collaborator password
 *     tags: [Collaborator Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address
 *                 example: "john@alphaweb.com"
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 description: New password
 *                 example: "newpassword123"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Password changed successfully"
 *       404:
 *         description: Collaborator not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Collaborator not found"
 *       500:
 *         description: Password change failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Password change failed"
 */

// Configure nodemailer (env-driven; safe fallback)
let transporter;
try {
  if (String(process.env.EMAIL_DISABLED || '').toLowerCase() === 'true') {
    transporter = null;
  } else if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: process.env.EMAIL_USER && process.env.EMAIL_PASS ? {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      } : undefined,
      tls: { rejectUnauthorized: false },
      requireTLS: true,
      debug: true,
    });
  } else {
    // Default to Gmail if specified; otherwise mock
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
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
    console.warn('Email disabled or not configured. OTP:', otp, 'Recipient:', email);
    return { sent: false, reason: 'disabled_or_not_configured' };
  }
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP for AlphaWeb',
    text: `Your OTP is: ${otp}. It will expire in 10 minutes.`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    return { sent: true, info };
  } catch (err) {
    console.error('Email sending failed:', err && err.message ? err.message : err);
    return { sent: false, error: err };
  }
};

// Register collaborator
const registerCollaborator = async (req, res) => {
  try {
    const { fullName, email, phone, password, role } = req.body;

    // Check if collaborator already exists
    const existingCollaborator = await Collaborator.findOne({ where: { email } });
    if (existingCollaborator) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create collaborator
    const collaborator = await Collaborator.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role,
      otp,
      otpExpires,
    });

    // Try to send OTP email, but don't fail registration if email fails
    const emailResult = await sendOTPEmail(email, otp);
    res.status(201).json({
      message: emailResult.sent
        ? 'Collaborator registered successfully. Please verify your email with the OTP sent.'
        : 'Collaborator registered successfully. Email not sent; use the OTP below to verify.',
      collaboratorId: collaborator.id,
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error('Collaborator registration error:', error);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

// Login collaborator
const loginCollaborator = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find collaborator
    const collaborator = await Collaborator.findOne({ where: { email } });
    if (!collaborator) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, collaborator.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if email is verified
    if (!collaborator.isVerified) {
      return res.status(403).json({ message: 'Please verify your email first' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: collaborator.id, email: collaborator.email, type: 'collaborator' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      collaborator: {
        id: collaborator.id,
        fullName: collaborator.fullName,
        email: collaborator.email,
        role: collaborator.role,
      },
    });
  } catch (error) {
    console.error('Collaborator login error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// Forgot password for collaborator
const collaboratorForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const collaborator = await Collaborator.findOne({ where: { email } });
    if (!collaborator) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update collaborator with OTP
    await collaborator.update({ otp, otpExpires });

    // Send OTP email (non-blocking for dev)
    const emailResult = await sendOTPEmail(email, otp);
    res.json({
      message: emailResult.sent ? 'OTP sent to your email' : 'Email not sent; use the OTP shown here',
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error('Collaborator forgot password error:', error);
    res.status(500).json({ message: 'Failed to send OTP', error: error.message });
  }
};

// Resend OTP for collaborator
const collaboratorResendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    const collaborator = await Collaborator.findOne({ where: { email } });
    if (!collaborator) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Update collaborator with new OTP
    await collaborator.update({ otp, otpExpires });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp);
    res.json({
      message: emailResult.sent ? 'OTP resent to your email' : 'Email not sent; use the OTP shown here',
      otp: otp,
      emailSent: !!emailResult.sent,
    });
  } catch (error) {
    console.error('Collaborator resend OTP error:', error);
    res.status(500).json({ message: 'Failed to resend OTP', error: error.message });
  }
};

// Verify OTP for collaborator
const collaboratorVerifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const collaborator = await Collaborator.findOne({ where: { email } });
    if (!collaborator) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Check if OTP is valid and not expired
    if (collaborator.otp !== otp || new Date() > collaborator.otpExpires) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Mark email as verified and clear OTP
    await collaborator.update({
      isVerified: true,
      otp: null,
      otpExpires: null,
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Collaborator OTP verification error:', error);
    res.status(500).json({ message: 'OTP verification failed', error: error.message });
  }
};

// Change password for collaborator
const collaboratorChangePassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const collaborator = await Collaborator.findOne({ where: { email } });
    if (!collaborator) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await collaborator.update({ password: hashedPassword });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Collaborator change password error:', error);
    res.status(500).json({ message: 'Password change failed', error: error.message });
  }
};

module.exports = {
  registerCollaborator,
  loginCollaborator,
  collaboratorForgotPassword,
  collaboratorResendOTP,
  collaboratorVerifyOTP,
  collaboratorChangePassword,
};
