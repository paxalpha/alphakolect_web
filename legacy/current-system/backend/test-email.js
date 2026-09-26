require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('Testing Mailtrap Email Configuration...\n');
console.log('Configuration:');
console.log('- SMTP_HOST:', process.env.SMTP_HOST);
console.log('- SMTP_PORT:', process.env.SMTP_PORT);
console.log('- EMAIL_USER:', process.env.EMAIL_USER);
console.log('- EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NOT SET');
console.log('- EMAIL_FROM:', process.env.EMAIL_FROM);
console.log('');

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2525),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
  debug: true,
});

// Test email
const mailOptions = {
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
  to: 'test@example.com',
  subject: 'Test Email from AlphaWeb - Mailtrap',
  text: 'This is a test email to verify Mailtrap configuration is working correctly!',
  html: '<h1>Test Email</h1><p>This is a test email to verify Mailtrap configuration is working correctly!</p>',
};

console.log('Sending test email...\n');

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Error sending email:', error);
    process.exit(1);
  } else {
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('\n📧 Check your Mailtrap inbox at: https://mailtrap.io/inboxes');
    process.exit(0);
  }
});
