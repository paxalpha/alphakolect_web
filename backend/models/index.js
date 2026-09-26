const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Ensure environment variables are loaded for Sequelize as well
try {
  const backendEnvPath = path.join(__dirname, '..', '.env');
  const rootEnvPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(backendEnvPath)) {
    require('dotenv').config({ path: backendEnvPath });
  } else if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
  } else {
    require('dotenv').config();
  }
} catch (_) {}

const databaseUrl = process.env.DATABASE_URL;
const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

const validateConnectionSocket = (client) => {
  try {
    if (!client) return false;
    if (client._ending || client._connected === false) return false;
    if (client.connection && client.connection.stream && client.connection.stream.destroyed) return false;
    return true;
  } catch (_) {
    return false;
  }
};

const commonPoolConfig = {
  max: 20,
  min: 0,           // Evict idle connections to prevent stale socket reuse
  acquire: 30000,
  idle: 5000,       // Evict idle connections after 5 seconds
  evict: 5000,      // Prune dead/stale connections every 5 seconds
  validate: validateConnectionSocket,
};

let sequelize;
if (databaseUrl) {
  const shouldForceSsl = useSsl || /render\.com/i.test(databaseUrl) || /sslmode=require/i.test(databaseUrl);
  sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false,
    dialectOptions: {
      ...(shouldForceSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {}),
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000,
    },
    pool: commonPoolConfig,
  });
} else {
  const database = process.env.DB_NAME || 'alphacollect_db';
  const username = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 5432;

  sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ...(useSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {}),
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000,
    },
    pool: commonPoolConfig,
  });
}

// Automatic query retry interceptor for transient DB connection drops
const originalQuery = sequelize.query.bind(sequelize);
sequelize.query = async function (...args) {
  let retries = 3;
  while (retries > 0) {
    try {
      return await originalQuery(...args);
    } catch (err) {
      const isConnError =
        err.name === 'SequelizeConnectionError' ||
        err.name === 'SequelizeConnectionRefusedError' ||
        err.name === 'SequelizeHostNotFoundError' ||
        err.name === 'SequelizeHostNotReachableError' ||
        err.name === 'SequelizeInvalidConnectionError' ||
        err.name === 'SequelizeConnectionTimedOutError' ||
        /Connection terminated/i.test(err.message || '') ||
        /ECONNRESET/i.test(err.message || '') ||
        /ECONNREFUSED/i.test(err.message || '') ||
        /socket has been ended/i.test(err.message || '');

      if (isConnError && retries > 1) {
        retries--;
        console.warn(`[DB Retry] Connection error: "${err.message}". Evicting pool & retrying (${3 - retries}/3)...`);
        
        // Force eviction of stale connections from pool so retry opens a fresh TCP/SSL socket
        try {
          if (sequelize.connectionManager && sequelize.connectionManager.pool) {
            if (typeof sequelize.connectionManager.pool.clear === 'function') {
              sequelize.connectionManager.pool.clear();
            } else if (typeof sequelize.connectionManager.pool.drain === 'function') {
              sequelize.connectionManager.pool.drain();
            }
          }
        } catch (_) {}

        await new Promise((resolve) => setTimeout(resolve, 300));
      } else {
        throw err;
      }
    }
  }
};

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Import models
db.Merchant = require('./merchant')(sequelize, Sequelize.DataTypes);
db.Collaborator = require('./collaborator')(sequelize, Sequelize.DataTypes);
db.Agent = require('./agent')(sequelize, Sequelize.DataTypes);
db.Branch = require('./branch')(sequelize, Sequelize.DataTypes);
db.Customer = require('./customer')(sequelize, Sequelize.DataTypes);
db.Role = require('./role')(sequelize, Sequelize.DataTypes);
db.Staff = require('./staff')(sequelize, Sequelize.DataTypes);
db.User = require('./user')(sequelize, Sequelize.DataTypes);
db.Charge = require('./charge')(sequelize, Sequelize.DataTypes);
db.ChargeAssignment = require('./chargeAssignment')(sequelize, Sequelize.DataTypes);
db.Loan = require('./loan')(sequelize, Sequelize.DataTypes);
db.Investment = require('./investment')(sequelize, Sequelize.DataTypes);
db.Package = require('./package')(sequelize, Sequelize.DataTypes);
db.Collection = require('./collection')(sequelize, Sequelize.DataTypes);
db.WalletTransaction = require('./walletTransaction')(sequelize, Sequelize.DataTypes);
db.CustomerWallet = require('./customerWallet')(sequelize, Sequelize.DataTypes);
db.InvestmentApplication = require('./investmentApplication')(sequelize, Sequelize.DataTypes);
db.LoanApplication = require('./loanApplication')(sequelize, Sequelize.DataTypes);
db.Repayment = require('./repayment')(sequelize, Sequelize.DataTypes);
db.InvestmentTransaction = require('./investmentTransaction')(sequelize, Sequelize.DataTypes);
db.Remittance = require('./remittance')(sequelize, Sequelize.DataTypes);
db.Subscription = require('./subscription')(sequelize, Sequelize.DataTypes);

// Super Admin models
db.SuperAdmin = require('./SuperAdmin')(sequelize, Sequelize.DataTypes);
db.Activity = require('./activity')(sequelize, Sequelize.DataTypes);
db.Plan = require('./plan')(sequelize, Sequelize.DataTypes);
db.Transaction = require('./transaction')(sequelize, Sequelize.DataTypes);
db.AdminRole = require('./adminRole')(sequelize, Sequelize.DataTypes);
db.AdminStaff = require('./adminStaff')(sequelize, Sequelize.DataTypes);
db.AdminLog = require('./adminLog')(sequelize, Sequelize.DataTypes);
db.SupportTicket = require('./supportTicket')(sequelize, Sequelize.DataTypes);
db.TicketMessage = require('./ticketMessage')(sequelize, Sequelize.DataTypes);
db.Announcement = require('./announcement')(sequelize, Sequelize.DataTypes);
db.Faq = require('./faq')(sequelize, Sequelize.DataTypes);
db.WalletTier = require('./walletTier')(sequelize, Sequelize.DataTypes);
db.WalletUpgradeRequest = require('./walletUpgradeRequest')(sequelize, Sequelize.DataTypes);

// Accounting models
db.Account = require('./account')(sequelize, Sequelize.DataTypes);
db.JournalEntry = require('./journalEntry')(sequelize, Sequelize.DataTypes);
db.JournalLine = require('./journalLine')(sequelize, Sequelize.DataTypes);
db.FiscalPeriod = require('./fiscalPeriod')(sequelize, Sequelize.DataTypes);


// Define associations
db.Merchant.hasMany(db.Agent, { foreignKey: 'merchantId' });
db.Agent.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Merchant.hasMany(db.Branch, { foreignKey: 'merchantId' });
db.Branch.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Merchant.hasMany(db.Customer, { foreignKey: 'merchantId' });
db.Customer.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Merchant.hasMany(db.Staff, { foreignKey: 'merchantId' });
db.Staff.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

// Note: Agent model uses 'branch' as string field, not branchId foreign key
// db.Branch.hasMany(db.Agent, { foreignKey: 'branchId' });
// db.Agent.belongsTo(db.Branch, { foreignKey: 'branchId' });

db.Branch.hasMany(db.Customer, { foreignKey: 'branchId' });
db.Customer.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'Branch' });

db.Branch.hasMany(db.Staff, { foreignKey: 'branchId' });
db.Staff.belongsTo(db.Branch, { foreignKey: 'branchId' });

db.Agent.hasMany(db.Customer, { foreignKey: 'agentId' });
db.Customer.belongsTo(db.Agent, { foreignKey: 'agentId', as: 'Agent' });

db.Role.hasMany(db.Staff, { foreignKey: 'roleId' });
db.Staff.belongsTo(db.Role, { foreignKey: 'roleId' });

// Charge associations
db.Merchant.hasMany(db.Charge, { foreignKey: 'merchantId' });
db.Charge.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Charge.hasMany(db.ChargeAssignment, { foreignKey: 'charge_id' });
db.ChargeAssignment.belongsTo(db.Charge, { foreignKey: 'charge_id' });

db.Customer.hasMany(db.ChargeAssignment, { foreignKey: 'customer_id' });
db.ChargeAssignment.belongsTo(db.Customer, { foreignKey: 'customer_id' });

db.Merchant.hasMany(db.ChargeAssignment, { foreignKey: 'merchant_id' });
db.ChargeAssignment.belongsTo(db.Merchant, { foreignKey: 'merchant_id' });

// Loan associations
db.Merchant.hasMany(db.Loan, { foreignKey: 'merchantId' });
db.Loan.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.Loan, { foreignKey: 'customerId' });
db.Loan.belongsTo(db.Customer, { foreignKey: 'customerId' });

// Investment associations
db.Merchant.hasMany(db.Investment, { foreignKey: 'merchantId' });
db.Investment.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.Investment, { foreignKey: 'customerId' });
db.Investment.belongsTo(db.Customer, { foreignKey: 'customerId' });

// Package associations
db.Merchant.hasMany(db.Package, { foreignKey: 'merchantId' });
db.Package.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

// Customer ↔ Package associations
db.Package.hasMany(db.Customer, { foreignKey: 'packageId' });
db.Customer.belongsTo(db.Package, { foreignKey: 'packageId', as: 'Package' });

// Collection associations
db.Merchant.hasMany(db.Collection, { foreignKey: 'merchantId' });
db.Collection.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.Collection, { foreignKey: 'customerId' });
db.Collection.belongsTo(db.Customer, { foreignKey: 'customerId' });

// Wallet Transaction associations
db.Merchant.hasMany(db.WalletTransaction, { foreignKey: 'merchantId' });
db.WalletTransaction.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

// Wallet Upgrade Request associations
db.Merchant.hasMany(db.WalletUpgradeRequest, { foreignKey: 'merchantId' });
db.WalletUpgradeRequest.belongsTo(db.Merchant, { foreignKey: 'merchantId', as: 'Merchant' });
db.WalletUpgradeRequest.belongsTo(db.AdminStaff, { foreignKey: 'reviewedBy', as: 'Reviewer' });

// Subscription associations
db.Merchant.belongsTo(db.Plan, { foreignKey: 'plan_id', as: 'plan' });
db.Plan.hasMany(db.Merchant, { foreignKey: 'plan_id' });
db.Merchant.hasMany(db.Subscription, { foreignKey: 'merchantId', as: 'history' });
db.Subscription.belongsTo(db.Merchant, { foreignKey: 'merchantId', as: 'merchant' });
db.Subscription.belongsTo(db.Plan, { foreignKey: 'planId', as: 'plan' });

// Customer Wallet associations - defined in individual model files

// Investment Application associations - defined in individual model files

// Loan Application associations
db.Merchant.hasMany(db.LoanApplication, { foreignKey: 'merchantId' });
db.LoanApplication.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.LoanApplication, { foreignKey: 'customerId' });
db.LoanApplication.belongsTo(db.Customer, { foreignKey: 'customerId' });

db.Agent.hasMany(db.LoanApplication, { foreignKey: 'agentId' });
db.LoanApplication.belongsTo(db.Agent, { foreignKey: 'agentId' });

db.Staff.hasMany(db.LoanApplication, { foreignKey: 'approvedBy' });
db.LoanApplication.belongsTo(db.Staff, { foreignKey: 'approvedBy' });

// Additional Loan associations
db.Agent.hasMany(db.Loan, { foreignKey: 'agentId' });
db.Loan.belongsTo(db.Agent, { foreignKey: 'agentId' });

db.Staff.hasMany(db.Loan, { foreignKey: 'approvedBy' });
db.Loan.belongsTo(db.Staff, { foreignKey: 'approvedBy' });

// Repayment associations
db.Loan.hasMany(db.Repayment, { foreignKey: 'loanId' });
db.Repayment.belongsTo(db.Loan, { foreignKey: 'loanId' });

db.Merchant.hasMany(db.Repayment, { foreignKey: 'merchantId' });
db.Repayment.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.Repayment, { foreignKey: 'customerId' });
db.Repayment.belongsTo(db.Customer, { foreignKey: 'customerId' });

db.Agent.hasMany(db.Repayment, { foreignKey: 'agentId' });
db.Repayment.belongsTo(db.Agent, { foreignKey: 'agentId' });

// Investment Transaction associations
db.Merchant.hasMany(db.InvestmentTransaction, { foreignKey: 'merchantId' });
db.InvestmentTransaction.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

db.Customer.hasMany(db.InvestmentTransaction, { foreignKey: 'customerId' });
db.InvestmentTransaction.belongsTo(db.Customer, { foreignKey: 'customerId' });

// Remittance associations
db.Merchant.hasMany(db.Remittance, { foreignKey: 'merchantId' });
db.Remittance.belongsTo(db.Merchant, { foreignKey: 'merchantId' });
db.Customer.hasMany(db.Remittance, { foreignKey: 'customerId' });
db.Remittance.belongsTo(db.Customer, { foreignKey: 'customerId' });
db.Agent.hasMany(db.Remittance, { foreignKey: 'agentId' });
db.Remittance.belongsTo(db.Agent, { foreignKey: 'agentId' });

// Transaction associations
db.Merchant.hasMany(db.Transaction, { foreignKey: 'merchantId' });
db.Transaction.belongsTo(db.Merchant, { foreignKey: 'merchantId' });

// Admin Role and Staff associations
db.AdminRole.hasMany(db.AdminStaff, { foreignKey: 'roleId' });
db.AdminStaff.belongsTo(db.AdminRole, { foreignKey: 'roleId' });

// Admin Log associations
db.AdminStaff.hasMany(db.AdminLog, { foreignKey: 'staffId' });
db.AdminLog.belongsTo(db.AdminStaff, { foreignKey: 'staffId' });


// Call associate functions for all models
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

module.exports = db;
