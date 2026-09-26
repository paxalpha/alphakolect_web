const db = require('./models');
const bcrypt = require('bcryptjs');

async function setupAdminStaffAndRoles() {
  try {
    console.log('🔍 Checking admin tables...');

    // Check if tables exist by trying to count
    try {
      const roleCount = await db.AdminRole.count();
      const staffCount = await db.AdminStaff.count();
      const logCount = await db.AdminLog.count();
      
      console.log(`✅ Tables exist!`);
      console.log(`   - admin_roles: ${roleCount} records`);
      console.log(`   - admin_staff: ${staffCount} records`);
      console.log(`   - admin_logs: ${logCount} records`);

      // Create sample role if none exist
      if (roleCount === 0) {
        console.log('\n📝 Creating sample admin role...');
        const role = await db.AdminRole.create({
          name: 'Super Administrator',
          permissions: [
            'view_merchants', 'create_merchant', 'edit_merchant', 'delete_merchant', 'approve_merchant', 'suspend_merchant',
            'view_transactions', 'approve_transaction', 'reject_transaction', 'refund_transaction',
            'view_plans', 'create_plan', 'edit_plan', 'delete_plan',
            'view_roles', 'create_role', 'edit_role', 'delete_role',
            'view_staff', 'create_staff', 'edit_staff', 'delete_staff',
            'view_activities', 'view_logs',
            'view_dashboard', 'view_analytics',
            'manage_settings', 'manage_notifications'
          ],
          description: 'Full system access',
          status: 'active'
        });
        console.log(`✅ Created role: ${role.name} (ID: ${role.id})`);

        // Create sample admin staff
        console.log('\n📝 Creating sample admin staff...');
        const hashedPassword = await bcrypt.hash('Admin@123456', 10);
        const staff = await db.AdminStaff.create({
          name: 'System Administrator',
          email: 'sysadmin@alphaweb.com',
          phoneNumber: '+2348012345678',
          password: hashedPassword,
          roleId: role.id,
          status: 'active'
        });
        console.log(`✅ Created staff: ${staff.name} (${staff.email})`);

        // Create sample log
        console.log('\n📝 Creating sample admin log...');
        const log = await db.AdminLog.create({
          staffId: staff.id,
          action: 'System Setup',
          details: 'Initial admin staff and role created',
          ipAddress: '127.0.0.1'
        });
        console.log(`✅ Created log entry (ID: ${log.id})`);
      }

      console.log('\n🎉 Admin tables are ready!');
    } catch (tableError) {
      console.error('❌ Tables do not exist or there was an error:', tableError.message);
      console.log('\n💡 You may need to run migrations to create the tables.');
      console.log('   Run: npx sequelize-cli db:migrate');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupAdminStaffAndRoles();
