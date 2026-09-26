const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { swaggerUi, swaggerSpec } = require('./swagger');
require('dotenv').config();

// Configure multer for form-data (including file uploads)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '';
    cb(null, file.fieldname + '-' + unique + ext);
  }
});
const upload = multer({ storage });

// Import models and database
const db = require('./models');

// Import controllers
const authController = require('./controllers/authController');
const collaboratorController = require('./controllers/collaboratorController');
// Mobile controllers removed
const agentController = require('./controllers/agentController');
const userController = require('./controllers/userController');
const branchController = require('./controllers/branchController');
const customerController = require('./controllers/customerController');
const roleController = require('./controllers/roleController');
const staffController = require('./controllers/staffController');
const chargeController = require('./controllers/chargeController');
const loanController = require('./controllers/loanController');
const investmentController = require('./controllers/investmentController');
const investmentTransactionController = require('./controllers/investmentTransactionController');
const investmentApplicationController = require('./controllers/investmentApplicationController');
const loanApplicationController = require('./controllers/loanApplicationController');
const repaymentController = require('./controllers/repaymentController');
const packageController = require('./controllers/packageController');
const collectionController = require('./controllers/collectionController');
const walletController = require('./controllers/walletController');
const remittanceController = require('./controllers/remittanceController');
const customerWalletController = require('./controllers/customerWalletController');
const dashboardController = require('./controllers/dashboardController');
const superAdminController = require('./controllers/superAdminController');
const merchantManagementController = require('./controllers/merchantManagementController');
const accountingController = require('./controllers/accountingController');
const walletTierController = require('./controllers/walletTierController');
const verificationController = require('./controllers/verificationController');
const webhookController = require('./controllers/webhookController');


// Import middleware
const { verifyToken, requireMerchant, requireCollaborator, requireAuthenticated, requireSuperAdmin } = require('./middleware/auth');

// Swagger configuration moved to ./swagger.js

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// app.use(cors());
app.use(cors({
  origin: "*", // or "https://alphakolect.com"
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization"
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Swagger UI
// Prevent caching of the Swagger UI/spec in browsers and proxies
app.use('/api-docs', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
}, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'AlphaWeb API Documentation'
}));
// Raw JSON spec endpoint
app.get('/api-docs/swagger.json', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Test database connection using shared instance
db.sequelize.authenticate()
  .then(() => {
    console.log('Database connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

// Sync database - disabled to avoid column name conflicts
// db.sequelize.sync({ force: false })
//   .then(() => {
//     console.log('Database synchronized successfully.');
//   })
//   .catch(err => {
//     console.error('Error synchronizing database:', err);
//   });

// Routes
// Mobile/Agent authentication
app.post('/api/auth/login', userController.loginUser);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Webhooks
app.post('/api/webhooks/transactpay', webhookController.handleTransactPayWebhook);

app.post('/merchant/signup', authController.registerMerchant);
app.post('/merchant/login', authController.loginMerchant);
app.post('/merchant/forgot-password', authController.forgotPassword);
app.post('/merchant/resend-otp', authController.resendOTP);
app.post('/merchant/verify-otp', authController.verifyOTP);
app.post('/merchant/change-password', authController.changePassword);
app.get('/merchant/profile', verifyToken, authController.getMerchantProfile);

// Collaborator authentication routes
app.post('/collaborator/signup', collaboratorController.registerCollaborator);
app.post('/collaborator/login', collaboratorController.loginCollaborator);
app.post('/collaborator/forgot-password', collaboratorController.collaboratorForgotPassword);
app.post('/collaborator/resend-otp', collaboratorController.collaboratorResendOTP);
app.post('/collaborator/verify-otp', collaboratorController.collaboratorVerifyOTP);
app.post('/collaborator/change-password', collaboratorController.collaboratorChangePassword);

// Super Admin authentication routes
app.post('/superadmin/login', superAdminController.loginSuperAdmin);

// Super Admin protected routes
app.get('/superadmin/superStats', verifyToken, requireSuperAdmin, superAdminController.getSuperAdminStats);
app.get('/superadmin/merchantStats', verifyToken, requireSuperAdmin, superAdminController.getMerchantStats);
app.get('/superadmin/allActivities', verifyToken, requireSuperAdmin, superAdminController.getAllActivities);
app.get('/superadmin/allMerchants', verifyToken, requireSuperAdmin, superAdminController.getAllMerchants);
app.get('/superadmin/allTransactions', verifyToken, requireSuperAdmin, superAdminController.getAllTransactions);
app.post('/superadmin/createPlan', verifyToken, requireSuperAdmin, superAdminController.createPlan);
app.get('/superadmin/getAllPlans', verifyToken, requireSuperAdmin, superAdminController.getAllPlans);
app.put('/superadmin/plans/:id', verifyToken, requireSuperAdmin, superAdminController.updatePlan);
app.delete('/superadmin/plans/:id', verifyToken, requireSuperAdmin, superAdminController.deletePlan);
app.post('/superadmin/createRole', verifyToken, requireSuperAdmin, superAdminController.createRole);
app.put('/superadmin/updateRole/:id', verifyToken, requireSuperAdmin, superAdminController.updateRole);
app.delete('/superadmin/deleteRole/:id', verifyToken, requireSuperAdmin, superAdminController.deleteRole);
app.get('/superadmin/getAllPermissions', verifyToken, requireSuperAdmin, superAdminController.getAllPermissions);
app.get('/superadmin/getAllRoles', verifyToken, requireSuperAdmin, superAdminController.getAllRoles);
app.post('/superadmin/createAdminStaff', verifyToken, requireSuperAdmin, superAdminController.createAdminStaff);
app.put('/superadmin/updateAdminStaff/:id', verifyToken, requireSuperAdmin, superAdminController.updateAdminStaff);
app.get('/superadmin/getAllAdminStaff', verifyToken, requireSuperAdmin, superAdminController.getAllAdminStaff);
app.get('/superadmin/logs', verifyToken, requireSuperAdmin, superAdminController.getAllAdminLogs);
app.get('/superadmin/logs/:staffId', verifyToken, requireSuperAdmin, superAdminController.getAdminLogsByStaff);

// Support Tickets
app.get('/superadmin/tickets', verifyToken, requireSuperAdmin, superAdminController.getAllTickets);
app.get('/superadmin/tickets/:id', verifyToken, requireSuperAdmin, superAdminController.getTicketDetails);
app.post('/superadmin/tickets/:id/reply', verifyToken, requireSuperAdmin, superAdminController.replyToTicket);
app.put('/superadmin/tickets/:id/status', verifyToken, requireSuperAdmin, superAdminController.updateTicketStatus);

// Announcements
app.get('/superadmin/announcements', verifyToken, requireSuperAdmin, superAdminController.getAllAnnouncements);
app.post('/superadmin/announcements', verifyToken, requireSuperAdmin, superAdminController.createAnnouncement);
app.delete('/superadmin/announcements/:id', verifyToken, requireSuperAdmin, superAdminController.deleteAnnouncement);

// FAQs
app.get('/superadmin/faqs', verifyToken, requireSuperAdmin, superAdminController.getAllFaqs);
app.post('/superadmin/faqs', verifyToken, requireSuperAdmin, superAdminController.createFaq);
app.delete('/superadmin/faqs/:id', verifyToken, requireSuperAdmin, superAdminController.deleteFaq);

// Merchant Management routes (Super Admin only)
app.put('/superadmin/merchants/:id', verifyToken, requireSuperAdmin, merchantManagementController.updateMerchant);
app.put('/superadmin/merchants/:id/status', verifyToken, requireSuperAdmin, merchantManagementController.updateMerchantStatus);
app.put('/superadmin/merchants/:id/reset-password', verifyToken, requireSuperAdmin, merchantManagementController.resetMerchantPassword);
app.delete('/superadmin/merchants/:id', verifyToken, requireSuperAdmin, merchantManagementController.deleteMerchant);

// Merchant detail tabs routes
app.get('/superadmin/merchants/:id/transactions', verifyToken, requireSuperAdmin, merchantManagementController.getMerchantTransactions);
app.get('/superadmin/merchants/:id/subscriptions', verifyToken, requireSuperAdmin, merchantManagementController.getMerchantSubscriptions);
app.get('/superadmin/merchants/:id/logs', verifyToken, requireSuperAdmin, merchantManagementController.getMerchantLogs);

// Wallet Tier routes (Super Admin)
app.get('/superadmin/wallet-tiers', verifyToken, requireSuperAdmin, walletTierController.listTiers);
app.post('/superadmin/wallet-tiers', upload.none(), verifyToken, requireSuperAdmin, walletTierController.createTier);
app.put('/superadmin/wallet-tiers', upload.none(), verifyToken, requireSuperAdmin, walletTierController.updateTier);
app.get('/superadmin/wallet-tiers/:id', verifyToken, requireSuperAdmin, walletTierController.getTierById);
app.delete('/superadmin/wallet-tiers/:id', verifyToken, requireSuperAdmin, walletTierController.deleteTier);

// Verifications / Upgrade Requests (Super Admin)
app.get('/superadmin/verifications', verifyToken, requireSuperAdmin, verificationController.listUpgradeRequests);
app.put('/superadmin/verifications/status', verifyToken, requireSuperAdmin, verificationController.updateRequestStatus);
app.get('/superadmin/verifications/:id', verifyToken, requireSuperAdmin, verificationController.getRequestDetails);

// Mobile endpoints removed

// Protected routes (require authentication)

// Agent routes
app.post('/agents', upload.none(), verifyToken, requireAuthenticated, agentController.registerAgent);
app.put('/agents', upload.none(), verifyToken, requireAuthenticated, agentController.updateAgent);
app.get('/agents', verifyToken, requireAuthenticated, agentController.listAgents);
app.get('/agents/:id', verifyToken, requireAuthenticated, agentController.getAgentById);
app.patch('/agents/:id/status', upload.none(), verifyToken, requireAuthenticated, agentController.updateAgentStatus);


// Branch routes
app.post('/branches', upload.none(), verifyToken, requireAuthenticated, branchController.createBranch);
app.put('/branches', upload.none(), verifyToken, requireAuthenticated, branchController.updateBranch);
app.get('/branches', verifyToken, requireAuthenticated, branchController.listBranches);
app.get('/branches/:id', verifyToken, requireAuthenticated, branchController.getBranchById);
app.delete('/branches/:id', verifyToken, requireAuthenticated, branchController.deleteBranch);

// Customer routes
app.post('/customers', upload.none(), verifyToken, requireAuthenticated, customerController.createCustomer);
app.get('/customers', verifyToken, requireAuthenticated, customerController.listCustomers);
app.get('/customers/:id', verifyToken, requireAuthenticated, customerController.getCustomerById);
app.put('/customers', upload.none(), verifyToken, requireAuthenticated, customerController.updateCustomer);

// Role routes
app.post('/roles', upload.none(), verifyToken, requireAuthenticated, roleController.createRole);
app.put('/roles', upload.none(), verifyToken, requireAuthenticated, roleController.updateRole);
app.get('/roles', verifyToken, requireAuthenticated, roleController.listRoles);
app.get('/roles/:id', verifyToken, requireAuthenticated, roleController.getRoleById);

// Staff routes
app.post('/staff', upload.none(), verifyToken, requireAuthenticated, staffController.createStaff);
app.put('/staff', upload.none(), verifyToken, requireAuthenticated, staffController.updateStaff);
app.get('/staff', verifyToken, requireAuthenticated, staffController.listStaff);
app.get('/staff/:id', verifyToken, requireAuthenticated, staffController.getStaffById);

// Charge routes
app.post('/charges', upload.none(), verifyToken, requireAuthenticated, chargeController.createCharge);
app.get('/charges', verifyToken, requireAuthenticated, chargeController.getCharges);
app.put('/charges', upload.none(), verifyToken, requireAuthenticated, chargeController.updateCharge);
app.delete('/charges/:id', verifyToken, requireAuthenticated, chargeController.deleteCharge);
app.post('/charges/assign', upload.none(), verifyToken, requireAuthenticated, chargeController.assignCharge);
app.get('/charges/history', verifyToken, requireAuthenticated, chargeController.getChargeHistory);
app.put('/charges/assignments/status', upload.none(), verifyToken, requireAuthenticated, chargeController.updateChargeAssignmentStatus);

// Investment routes
app.post('/investments', upload.none(), verifyToken, requireAuthenticated, investmentController.createInvestment);
app.get('/investments', verifyToken, requireAuthenticated, investmentController.getInvestments);
app.get('/investments/:id', verifyToken, requireAuthenticated, investmentController.getInvestmentById);
// app.put('/investments', upload.none(), verifyToken, requireAuthenticated, investmentController.updateInvestment);
app.delete('/investments/:id', verifyToken, requireAuthenticated, investmentController.deleteInvestment);

// Investment Transaction routes
app.post('/investment-transactions', upload.none(), verifyToken, requireAuthenticated, investmentTransactionController.createInvestmentTransaction);
app.get('/investment-transactions', verifyToken, requireAuthenticated, investmentTransactionController.getInvestmentTransactions);
app.get('/investment-transactions/:id', verifyToken, requireAuthenticated, investmentTransactionController.getInvestmentTransactionById);
app.put('/investment-transactions/:id', upload.none(), verifyToken, requireAuthenticated, investmentTransactionController.updateInvestmentTransaction);
app.delete('/investment-transactions/:id', verifyToken, requireAuthenticated, investmentTransactionController.deleteInvestmentTransaction);

app.post('/investment-applications', upload.none(), verifyToken, requireAuthenticated, investmentApplicationController.createInvestmentApplication);
app.get('/investment-applications', verifyToken, requireAuthenticated, investmentApplicationController.getInvestmentApplications);

app.get('/investment-applications/:id', verifyToken, requireAuthenticated, investmentApplicationController.getInvestmentApplicationById);
app.delete('/investment-applications/:id', verifyToken, requireAuthenticated, investmentApplicationController.deleteInvestmentApplication);

app.put('/investment-applications/:id/status', upload.none(), verifyToken, requireAuthenticated, investmentApplicationController.updateApplicationStatus);
app.put('/investment-applications/:id', upload.none(), verifyToken, requireAuthenticated, investmentApplicationController.updateInvestmentApplication);

// Loan Application routes
app.post('/loan-applications', upload.none(), verifyToken, requireAuthenticated, loanApplicationController.createLoanApplication);
app.get('/loan-applications', verifyToken, requireAuthenticated, loanApplicationController.getLoanApplications);
app.get('/loan-applications/:id', verifyToken, requireAuthenticated, loanApplicationController.getLoanApplicationById);
app.put('/loan-applications/:id/status', upload.none(), verifyToken, requireAuthenticated, loanApplicationController.updateApplicationStatus);
app.delete('/loan-applications/:id', verifyToken, requireAuthenticated, loanApplicationController.deleteLoanApplication);

// Loan routes
app.post('/loans', upload.single('loanForm'), verifyToken, requireAuthenticated, loanController.createLoan);
app.get('/loans', verifyToken, requireAuthenticated, loanController.getLoans);
app.get('/loans/:id', verifyToken, requireAuthenticated, loanController.getLoanById);
app.put('/loans/:id/status', upload.none(), verifyToken, requireAuthenticated, loanController.updateLoanStatus);
app.delete('/loans/:id', verifyToken, requireAuthenticated, loanController.deleteLoan);
app.get('/loans/stats/summary', verifyToken, requireAuthenticated, loanController.getLoanStats);

// Repayment routes
app.post('/repayments', upload.none(), verifyToken, requireAuthenticated, repaymentController.createRepayment);
app.get('/repayments', verifyToken, requireAuthenticated, repaymentController.getRepayments);
app.get('/repayments/:id', verifyToken, requireAuthenticated, repaymentController.getRepaymentById);
app.put('/repayments/:id/status', upload.none(), verifyToken, requireAuthenticated, repaymentController.updateRepaymentStatus);
app.delete('/repayments/:id', verifyToken, requireAuthenticated, repaymentController.deleteRepayment);
app.get('/repayments/stats/summary', verifyToken, requireAuthenticated, repaymentController.getRepaymentStats);

// Package routes
app.post('/packages', upload.none(), verifyToken, requireAuthenticated, packageController.createPackage);
app.get('/packages', verifyToken, requireAuthenticated, packageController.getPackages);
app.get('/packages/active', verifyToken, requireAuthenticated, packageController.getActivePackages);
app.get('/packages/:id', verifyToken, requireAuthenticated, packageController.getPackageById);
app.put('/packages', upload.none(), verifyToken, requireAuthenticated, packageController.updatePackage);
app.delete('/packages/:id', verifyToken, requireAuthenticated, packageController.deletePackage);

// Collection routes
app.post('/collections', upload.none(), verifyToken, requireAuthenticated, collectionController.createCollection);
app.post('/collections/bulk', upload.none(), verifyToken, requireAuthenticated, collectionController.createCollectionsBulk);
app.get('/collections', verifyToken, requireAuthenticated, collectionController.getCollections);
app.get('/collections/:id', verifyToken, requireAuthenticated, collectionController.getCollectionById);
app.put('/collections', upload.none(), verifyToken, requireAuthenticated, collectionController.updateCollection);
app.put('/collections/:id/collect', upload.none(), verifyToken, requireAuthenticated, collectionController.markAsCollected);
app.delete('/collections/:id', verifyToken, requireAuthenticated, collectionController.deleteCollection);
app.get('/collections/status/:status', verifyToken, requireAuthenticated, collectionController.getCollectionsByStatus);
app.get('/collections/overdue', verifyToken, requireAuthenticated, collectionController.getOverdueCollections);

// Wallet routes
app.get('/wallet/balance', verifyToken, requireAuthenticated, walletController.getWalletBalance);
app.post('/wallet/transactions', upload.none(), verifyToken, requireAuthenticated, walletController.createWalletTransaction);
app.get('/wallet/transactions', verifyToken, requireAuthenticated, walletController.getWalletTransactions);
app.get('/wallet/transactions/:id', verifyToken, requireAuthenticated, walletController.getWalletTransactionById);
app.put('/wallet/transactions/:id/status', upload.none(), verifyToken, requireAuthenticated, walletController.updateTransactionStatus);
app.get('/wallet/stats', verifyToken, requireAuthenticated, walletController.getWalletStats);
app.post('/wallet/transfer', upload.none(), verifyToken, requireAuthenticated, walletController.transferToCustomer);

// Public/Authenticated Wallet Tier list
app.get('/wallet-tiers', verifyToken, requireAuthenticated, walletTierController.listTiers);

// Merchant Upgrade Requests
app.post('/wallet/upgrade', upload.fields([
  { name: 'governmentId', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'proofOfAddress', maxCount: 1 },
  { name: 'businessCert', maxCount: 1 }
]), verifyToken, requireAuthenticated, verificationController.submitUpgradeRequest);
app.get('/wallet/upgrade-status', verifyToken, requireAuthenticated, async (req, res) => {
  try {
    const request = await db.WalletUpgradeRequest.findOne({
      where: { merchantId: req.user.id },
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Remittance routes
app.post('/remittances', upload.none(), verifyToken, requireAuthenticated, remittanceController.createRemittance);
app.get('/remittances', verifyToken, requireAuthenticated, remittanceController.listRemittances);
app.get('/remittances/:id', verifyToken, requireAuthenticated, remittanceController.getRemittanceById);
app.put('/remittances', upload.none(), verifyToken, requireAuthenticated, remittanceController.updateRemittance);
app.put('/remittances/:id/approve', upload.none(), verifyToken, requireAuthenticated, remittanceController.approveRemittance);
app.delete('/remittances/:id', verifyToken, requireAuthenticated, remittanceController.deleteRemittance);

// Customer Wallet routes
app.get('/customer-wallets', verifyToken, requireAuthenticated, customerWalletController.getCustomerWallets);
app.get('/customer-wallets/:id', verifyToken, requireAuthenticated, customerWalletController.getCustomerWalletById);
app.post('/customer-wallets', upload.none(), verifyToken, requireAuthenticated, customerWalletController.createCustomerWallet);
app.put('/customer-wallets/:id', upload.none(), verifyToken, requireAuthenticated, customerWalletController.updateCustomerWallet);
app.delete('/customer-wallets/:id', verifyToken, requireAuthenticated, customerWalletController.deleteCustomerWallet);
app.get('/customer-wallets/stats/summary', verifyToken, requireAuthenticated, customerWalletController.getCustomerWalletStats);

// Accounting routes
// Account (COA) routes
app.post('/accounting/accounts', upload.none(), verifyToken, requireAuthenticated, accountingController.createAccount);
app.get('/accounting/accounts', verifyToken, requireAuthenticated, accountingController.getAccounts);
app.get('/accounting/accounts/:id', verifyToken, requireAuthenticated, accountingController.getAccountById);
app.put('/accounting/accounts', upload.none(), verifyToken, requireAuthenticated, accountingController.updateAccount);
app.delete('/accounting/accounts/:id', verifyToken, requireAuthenticated, accountingController.deleteAccount);

// Journal Entry routes
app.post('/accounting/journal-entries', upload.none(), verifyToken, requireAuthenticated, accountingController.createJournalEntry);
app.get('/accounting/journal-entries', verifyToken, requireAuthenticated, accountingController.getJournalEntries);
app.get('/accounting/journal-entries/:id', verifyToken, requireAuthenticated, accountingController.getJournalEntryById);
app.post('/accounting/journal-entries/:id/post', upload.none(), verifyToken, requireAuthenticated, accountingController.postJournalEntry);
app.post('/accounting/journal-entries/:id/reverse', upload.none(), verifyToken, requireAuthenticated, accountingController.reverseJournalEntry);
app.delete('/accounting/journal-entries/:id', verifyToken, requireAuthenticated, accountingController.deleteJournalEntry);

// Ledger routes
app.get('/accounting/ledger', verifyToken, requireAuthenticated, accountingController.getGeneralLedger);

// Fiscal Period routes
app.post('/accounting/fiscal-periods', upload.none(), verifyToken, requireAuthenticated, accountingController.createFiscalPeriod);
app.get('/accounting/fiscal-periods', verifyToken, requireAuthenticated, accountingController.getFiscalPeriods);
app.put('/accounting/fiscal-periods/:id', upload.none(), verifyToken, requireAuthenticated, accountingController.updateFiscalPeriod);

// Report routes
app.get('/accounting/reports/trial-balance', verifyToken, requireAuthenticated, accountingController.getTrialBalance);
app.get('/accounting/reports/balance-sheet', verifyToken, requireAuthenticated, accountingController.getBalanceSheet);
app.get('/accounting/reports/income-statement', verifyToken, requireAuthenticated, accountingController.getIncomeStatement);

// Dashboard routes

app.get('/dashboard/stats', verifyToken, requireAuthenticated, dashboardController.getDashboardStats);
app.get('/dashboard/transaction-stats', verifyToken, requireAuthenticated, dashboardController.getTransactionStats);
app.get('/dashboard/agent-customer-stats', verifyToken, requireAuthenticated, dashboardController.getAgentCustomerStats);
app.get('/dashboard/agent-summary', verifyToken, requireAuthenticated, dashboardController.getAgentSummary);

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Alphaweb Backend API' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;


