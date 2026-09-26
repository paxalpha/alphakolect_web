// List of all available permissions for admin roles
const PERMISSIONS = [
  // Merchant Management
  'view_merchants',
  'create_merchant',
  'edit_merchant',
  'delete_merchant',
  'approve_merchant',
  'suspend_merchant',
  
  // Transaction Management
  'view_transactions',
  'approve_transaction',
  'reject_transaction',
  'refund_transaction',
  
  // Plan Management
  'view_plans',
  'create_plan',
  'edit_plan',
  'delete_plan',
  
  // Role & Staff Management
  'view_roles',
  'create_role',
  'edit_role',
  'delete_role',
  'view_staff',
  'create_staff',
  'edit_staff',
  'delete_staff',
  
  // Activity & Logs
  'view_activities',
  'view_logs',
  
  // Dashboard & Analytics
  'view_dashboard',
  'view_analytics',
  
  // System Settings
  'manage_settings',
  'manage_notifications',
];

module.exports = PERMISSIONS;
