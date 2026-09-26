const nodemailer = require('nodemailer');
require('dotenv').config({ path: '/home/mayowae/public_html/alphaweb/backend/.env' });

async function testEmail() {
    console.log('Using SMTP Settings:');
    console.log('Host:', process.env.SMTP_HOST);
    console.log('Port:', process.env.SMTP_PORT);
    console.log('User:', process.env.EMAIL_USER);
    console.log('Secure:', process.env.SMTP_SECURE);

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        tls: { rejectUnauthorized: false }
    });

    try {
        console.log('Attempting to verify transporter...');
        await transporter.verify();
        console.log('Transporter is ready to take our messages');

        console.log('Sending test email...');
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: 'mayowae@msn.com', // Using the email seen in logs
            subject: 'AlphaWeb SMTP Test',
            text: 'This is a test email to verify SMTP configuration.'
        });
        console.log('Message sent: %s', info.messageId);
    } catch (error) {
        console.error('SMTP Error:', error);
    }
}

testEmail();
