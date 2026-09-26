const bcrypt = require('bcryptjs');
const { SuperAdmin } = require('./models');
const { findSuperAdminByEmail, validateNewPassword } = require('./controllers/superAdminPasswordResetController');

// Creates a Super Admin from environment variables. Nothing is hardcoded and the password is
// never printed. Usage (PowerShell):
//   $env:SUPER_ADMIN_EMAIL='owner@example.com'; $env:SUPER_ADMIN_NAME='Owner'; $env:SUPER_ADMIN_PASSWORD='<strong password>'
//   node create-super-admin.js
// Unset SUPER_ADMIN_PASSWORD afterwards. To recover a forgotten password, use /admin/forgot-password.
async function createSuperAdmin() {
  try {
    const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim();
    const name = String(process.env.SUPER_ADMIN_NAME || 'Super Administrator').trim();
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const role = 'superadmin';

    if (!email || !password) {
      console.error('❌ Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (and optionally SUPER_ADMIN_NAME).');
      process.exit(1);
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      console.error(`❌ ${passwordError}`);
      process.exit(1);
    }

    console.log('Creating Super Admin account...\n');

    // Check if super admin already exists (case-insensitive)
    const existingAdmin = await findSuperAdminByEmail(email);
    if (existingAdmin) {
      console.log('⚠️  A Super Admin already exists with this email. Nothing changed.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await SuperAdmin.create({ name, email, password: hashedPassword, role });

    console.log('✅ Super Admin account created.');
    console.log('📧 Email:', email);
    console.log('👤 Name:', name);
    console.log('🎭 Role:', role);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();
