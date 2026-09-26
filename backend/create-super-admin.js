const bcrypt = require('bcryptjs');
const { SuperAdmin, sequelize } = require('./models');

async function createSuperAdmin() {
  try {
    console.log('Creating Super Admin account...\n');

    // Super Admin credentials
    const email = 'admin@alphaweb.com';
    const password = 'Admin@123456';
    const name = 'Super Administrator';
    const role = 'superadmin';

    // Check if super admin already exists
    const existingAdmin = await SuperAdmin.findOne({ where: { email } });
    
    if (existingAdmin) {
      console.log('⚠️  Super Admin already exists with this email!');
      console.log('\n📧 Email:', email);
      console.log('🔑 Password: Admin@123456');
      console.log('\nYou can use these credentials to login at /admin\n');
      process.exit(0);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create super admin
    const superAdmin = await SuperAdmin.create({
      name,
      email,
      password: hashedPassword,
      role,
    });

    console.log('✅ Super Admin account created successfully!\n');
    console.log('='.repeat(50));
    console.log('LOGIN CREDENTIALS:');
    console.log('='.repeat(50));
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Name:', name);
    console.log('🎭 Role:', role);
    console.log('='.repeat(50));
    console.log('\n✨ You can now login at: http://localhost:3000/admin');
    console.log('\n⚠️  IMPORTANT: Please change the password after first login!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super admin:', error);
    console.error('\nError details:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();
