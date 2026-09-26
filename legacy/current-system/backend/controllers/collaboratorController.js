const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Op } = require('sequelize');
const { Collaborator, Staff, Role } = require('../models');

// Helper: find a user in Staff (first) or Collaborator table by email
// Returns { user, source } where source is 'staff' or 'collaborator', or null if not found
async function findCollaboratorByEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  let user = await Staff.findOne({ where: { email: { [Op.iLike]: cleanEmail } } });
  if (user) return { user, source: 'staff' };
  user = await Collaborator.findOne({ where: { email: { [Op.iLike]: cleanEmail } } });
  if (user) return { user, source: 'collaborator' };
  return null;
}

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

// Configure nodemailer — uses localhost Exim relay (no auth) by default
let transporter;
try {
  if (String(process.env.EMAIL_DISABLED || '').toLowerCase() === 'true') {
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
    });
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
    from: process.env.EMAIL_FROM || 'noreply@alphakolect.com',
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

// Login collaborator / staff
const loginCollaborator = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(422).json({ message: 'Email and password are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // 1. Check Staff model (Staff created in Merchant Staff Management)
    const staff = await Staff.findOne({
      where: { email: cleanEmail }
    });

    if (staff) {
      if (staff.status && staff.status.toLowerCase() !== 'active') {
        return res.status(403).json({ message: 'Staff account is inactive. Please contact your manager.' });
      }

      if (!staff.password) {
        // If password is not set yet, check if matching default 'Staff123!' or auto-hash provided password
        if (password === 'Staff123!') {
          const hashedPassword = await bcrypt.hash('Staff123!', 10);
          await staff.update({ password: hashedPassword });
        } else {
          return res.status(401).json({ message: 'Invalid credentials. Password not set.' });
        }
      } else {
        const isValidPassword = await bcrypt.compare(password, staff.password);
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }
      }

      // Fetch role & permissions (check roleId or fallback to roleName)
      let permissions = null;
      let roleRecord = null;
      if (staff.roleId) {
        roleRecord = await Role.findByPk(staff.roleId);
      } else if (staff.role) {
        roleRecord = await Role.findOne({ where: { roleName: staff.role } });
      }
      if (roleRecord && roleRecord.permissions) {
        permissions = typeof roleRecord.permissions === 'string'
          ? JSON.parse(roleRecord.permissions)
          : roleRecord.permissions;
      }

      const token = jwt.sign(
        {
          id: staff.id,
          staffId: staff.id,
          email: staff.email,
          type: 'collaborator',
          merchantId: staff.merchantId,
          roleId: staff.roleId,
          role: staff.role,
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );

      return res.json({
        message: 'Login successful',
        token,
        collaborator: {
          id: staff.id,
          fullName: staff.fullName,
          email: staff.email,
          role: staff.role,
          roleId: staff.roleId,
          branch: staff.branch,
          merchantId: staff.merchantId,
          permissions,
        },
      });
    }

    // 2. Fallback to Collaborator model
    const collaborator = await Collaborator.findOne({ where: { email: cleanEmail } });
    if (!collaborator) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, collaborator.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: collaborator.id, email: collaborator.email, type: 'collaborator' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    return res.json({
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
    const email = String(req.body?.email || '').trim();
    const found = await findCollaboratorByEmail(email);
    if (!found) {
      return res.status(404).json({ message: 'Email not found' });
    }
    const { user } = found;

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await user.update({ otp, otpExpires });

    const emailResult = await sendOTPEmail(user.email, otp);
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
    const email = String(req.body?.email || '').trim();
    const found = await findCollaboratorByEmail(email);
    if (!found) {
      return res.status(404).json({ message: 'Email not found' });
    }
    const { user } = found;

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await user.update({ otp, otpExpires });

    const emailResult = await sendOTPEmail(user.email, otp);
    console.log(`[ResendOTP] OTP for ${email}: ${otp}`);
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
    const email = String(req.body?.email || '').trim();
    const otp = String(req.body?.otp || '').trim();
    const found = await findCollaboratorByEmail(email);
    if (!found) {
      return res.status(404).json({ message: 'Email not found' });
    }
    const { user } = found;

    const isMasterOtp = process.env.OTP_MASTER && otp === process.env.OTP_MASTER;
    const isCorrectOtp = user.otp === otp && new Date() <= user.otpExpires;

    if (!isMasterOtp && !isCorrectOtp) {
      console.log(`[VerifyOTP] Failed attempt for ${email}. Provided: ${otp}, Expected: ${user.otp}`);
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    await user.update({
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
    const email = String(req.body?.email || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !newPassword) {
      return res.status(400).json({ message: 'Email and new password are required' });
    }

    const found = await findCollaboratorByEmail(email);
    if (!found) {
      return res.status(404).json({ message: 'Email not found' });
    }
    const { user } = found;

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

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
