const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    try {
      console.log('🧩 Ensuring SQL prerequisites (snake_case columns) before SQL migrations...');

      // Ensure loans table has snake_case columns expected by SQL migrations
      let loansInfo = null;
      try {
        loansInfo = await queryInterface.describeTable('loans');
      } catch (err) {
        // Table may not exist yet; nothing to normalize
        console.log('ℹ️  loans table not found yet; skipping loans normalization');
      }

      if (loansInfo) {
        // customer_id
        if (!loansInfo.customer_id) {
          console.log('➕ Adding missing column loans.customer_id');
          await queryInterface.addColumn('loans', 'customer_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          // If camelCase exists, try to backfill
          if (loansInfo.customerId) {
            await queryInterface.sequelize.query('UPDATE loans SET customer_id = "customerId" WHERE customer_id IS NULL');
          }
          // Add FK after column exists; SQL migrations will also add FK if missing
          try {
            await queryInterface.addConstraint('loans', {
              fields: ['customer_id'],
              type: 'foreign key',
              name: 'fk_loans_customer_id_pre',
              references: { table: 'customers', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // date_issued
        if (!loansInfo.date_issued) {
          console.log('➕ Adding missing column loans.date_issued');
          await queryInterface.addColumn('loans', 'date_issued', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (loansInfo.dateIssued) {
            await queryInterface.sequelize.query('UPDATE loans SET date_issued = "dateIssued" WHERE date_issued IS NULL');
          }
        }

        // due_date
        if (!loansInfo.due_date) {
          console.log('➕ Adding missing column loans.due_date');
          await queryInterface.addColumn('loans', 'due_date', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (loansInfo.dueDate) {
            await queryInterface.sequelize.query('UPDATE loans SET due_date = "dueDate" WHERE due_date IS NULL');
          }
        }

        // agent_id
        if (!loansInfo.agent_id) {
          console.log('➕ Adding missing column loans.agent_id');
          await queryInterface.addColumn('loans', 'agent_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (loansInfo.agentId) {
            await queryInterface.sequelize.query('UPDATE loans SET agent_id = "agentId" WHERE agent_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('loans', {
              fields: ['agent_id'],
              type: 'foreign key',
              name: 'fk_loans_agent_id_pre',
              references: { table: 'agents', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }

        // merchant_id
        if (!loansInfo.merchant_id) {
          console.log('➕ Adding missing column loans.merchant_id');
          await queryInterface.addColumn('loans', 'merchant_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (loansInfo.merchantId) {
            await queryInterface.sequelize.query('UPDATE loans SET merchant_id = "merchantId" WHERE merchant_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('loans', {
              fields: ['merchant_id'],
              type: 'foreign key',
              name: 'fk_loans_merchant_id_pre',
              references: { table: 'merchants', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // approved_by
        if (!loansInfo.approved_by) {
          console.log('➕ Adding missing column loans.approved_by');
          await queryInterface.addColumn('loans', 'approved_by', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (loansInfo.approvedBy) {
            await queryInterface.sequelize.query('UPDATE loans SET approved_by = "approvedBy" WHERE approved_by IS NULL');
          }
          try {
            await queryInterface.addConstraint('loans', {
              fields: ['approved_by'],
              type: 'foreign key',
              name: 'fk_loans_approved_by_pre',
              references: { table: 'staff', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }
      }

      // Ensure repayments table has snake_case columns expected by SQL migrations
      let repaymentsInfo = null;
      try {
        repaymentsInfo = await queryInterface.describeTable('repayments');
      } catch (err) {
        console.log('ℹ️  repayments table not found yet; skipping repayments normalization');
      }

      if (repaymentsInfo) {
        // transaction_id
        if (!repaymentsInfo.transaction_id) {
          console.log('➕ Adding missing column repayments.transaction_id');
          await queryInterface.addColumn('repayments', 'transaction_id', {
            type: DataTypes.STRING(100),
            allowNull: true,
          });
          // optional: unique index will be added by SQL migration
        }

        // loan_id
        if (!repaymentsInfo.loan_id) {
          console.log('➕ Adding missing column repayments.loan_id');
          await queryInterface.addColumn('repayments', 'loan_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (repaymentsInfo.loanId) {
            await queryInterface.sequelize.query('UPDATE repayments SET loan_id = "loanId" WHERE loan_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('repayments', {
              fields: ['loan_id'],
              type: 'foreign key',
              name: 'fk_repayments_loan_id_pre',
              references: { table: 'loans', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // customer_id
        if (!repaymentsInfo.customer_id) {
          console.log('➕ Adding missing column repayments.customer_id');
          await queryInterface.addColumn('repayments', 'customer_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (repaymentsInfo.customerId) {
            await queryInterface.sequelize.query('UPDATE repayments SET customer_id = "customerId" WHERE customer_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('repayments', {
              fields: ['customer_id'],
              type: 'foreign key',
              name: 'fk_repayments_customer_id_pre',
              references: { table: 'customers', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // agent_id
        if (!repaymentsInfo.agent_id) {
          console.log('➕ Adding missing column repayments.agent_id');
          await queryInterface.addColumn('repayments', 'agent_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (repaymentsInfo.agentId) {
            await queryInterface.sequelize.query('UPDATE repayments SET agent_id = "agentId" WHERE agent_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('repayments', {
              fields: ['agent_id'],
              type: 'foreign key',
              name: 'fk_repayments_agent_id_pre',
              references: { table: 'agents', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }

        // merchant_id
        if (!repaymentsInfo.merchant_id) {
          console.log('➕ Adding missing column repayments.merchant_id');
          await queryInterface.addColumn('repayments', 'merchant_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (repaymentsInfo.merchantId) {
            await queryInterface.sequelize.query('UPDATE repayments SET merchant_id = "merchantId" WHERE merchant_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('repayments', {
              fields: ['merchant_id'],
              type: 'foreign key',
              name: 'fk_repayments_merchant_id_pre',
              references: { table: 'merchants', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // date
        if (!repaymentsInfo.date) {
          console.log('➕ Adding missing column repayments.date');
          await queryInterface.addColumn('repayments', 'date', {
            type: DataTypes.DATE,
            allowNull: true,
          });
        }
      }

      // Ensure wallet_transactions table has snake_case columns expected by SQL migrations
      let walletTxInfo = null;
      try {
        walletTxInfo = await queryInterface.describeTable('wallet_transactions');
      } catch (err) {
        console.log('ℹ️  wallet_transactions table not found yet; skipping wallet_transactions normalization');
      }

      // Ensure investments table has snake_case columns expected by SQL migrations
      let investmentsInfo = null;
      try {
        investmentsInfo = await queryInterface.describeTable('investments');
      } catch (err) {
        console.log('ℹ️  investments table not found yet; skipping investments normalization');
      }

      // Ensure agents table has snake_case columns expected by SQL migrations
      let agentsInfo = null;
      try {
        agentsInfo = await queryInterface.describeTable('agents');
      } catch (err) {
        console.log('ℹ️  agents table not found yet; skipping agents normalization');
      }

      if (agentsInfo) {
        // merchant_id
        if (!agentsInfo.merchant_id) {
          console.log('➕ Adding missing column agents.merchant_id');
          await queryInterface.addColumn('agents', 'merchant_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (agentsInfo.merchantId) {
            await queryInterface.sequelize.query('UPDATE agents SET merchant_id = "merchantId" WHERE merchant_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('agents', {
              fields: ['merchant_id'],
              type: 'foreign key',
              name: 'fk_agents_merchant_id_pre',
              references: { table: 'merchants', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // branch (used by SQL index)
        if (!agentsInfo.branch) {
          console.log('➕ Adding missing column agents.branch');
          await queryInterface.addColumn('agents', 'branch', {
            type: DataTypes.STRING(100),
            allowNull: true,
          });
        }

        // full_name (backfill from name)
        if (!agentsInfo.full_name) {
          console.log('➕ Adding missing column agents.full_name');
          await queryInterface.addColumn('agents', 'full_name', {
            type: DataTypes.STRING(255),
            allowNull: true,
          });
          if (agentsInfo.name) {
            await queryInterface.sequelize.query('UPDATE agents SET full_name = "name" WHERE full_name IS NULL');
          }
        }

        // phone_number (backfill from phone)
        if (!agentsInfo.phone_number) {
          console.log('➕ Adding missing column agents.phone_number');
          await queryInterface.addColumn('agents', 'phone_number', {
            type: DataTypes.STRING(20),
            allowNull: true,
          });
          if (agentsInfo.phone) {
            await queryInterface.sequelize.query('UPDATE agents SET phone_number = "phone" WHERE phone_number IS NULL');
          }
        }

        // password (nullable; SQL expects it, but we won't force values)
        if (!agentsInfo.password) {
          console.log('➕ Adding missing column agents.password');
          await queryInterface.addColumn('agents', 'password', {
            type: DataTypes.STRING(255),
            allowNull: true,
          });
        }

        // customers_count
        if (!agentsInfo.customers_count) {
          console.log('➕ Adding missing column agents.customers_count');
          await queryInterface.addColumn('agents', 'customers_count', {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 0,
          });
        }

        // created_at
        if (!agentsInfo.created_at) {
          console.log('➕ Adding missing column agents.created_at');
          await queryInterface.addColumn('agents', 'created_at', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (agentsInfo.createdAt) {
            await queryInterface.sequelize.query('UPDATE agents SET created_at = "createdAt" WHERE created_at IS NULL');
          }
        }

        // updated_at
        if (!agentsInfo.updated_at) {
          console.log('➕ Adding missing column agents.updated_at');
          await queryInterface.addColumn('agents', 'updated_at', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (agentsInfo.updatedAt) {
            await queryInterface.sequelize.query('UPDATE agents SET updated_at = "updatedAt" WHERE updated_at IS NULL');
          }
        }
      }

      if (investmentsInfo) {
        // merchant_id
        if (!investmentsInfo.merchant_id) {
          console.log('➕ Adding missing column investments.merchant_id');
          await queryInterface.addColumn('investments', 'merchant_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (investmentsInfo.merchantId) {
            await queryInterface.sequelize.query('UPDATE investments SET merchant_id = "merchantId" WHERE merchant_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('investments', {
              fields: ['merchant_id'],
              type: 'foreign key',
              name: 'fk_investments_merchant_pre',
              references: { table: 'merchants', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // customer_id
        if (!investmentsInfo.customer_id) {
          console.log('➕ Adding missing column investments.customer_id');
          await queryInterface.addColumn('investments', 'customer_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (investmentsInfo.customerId) {
            await queryInterface.sequelize.query('UPDATE investments SET customer_id = "customerId" WHERE customer_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('investments', {
              fields: ['customer_id'],
              type: 'foreign key',
              name: 'fk_investments_customer_pre',
              references: { table: 'customers', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // agent_id
        if (!investmentsInfo.agent_id) {
          console.log('➕ Adding missing column investments.agent_id');
          await queryInterface.addColumn('investments', 'agent_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (investmentsInfo.agentId) {
            await queryInterface.sequelize.query('UPDATE investments SET agent_id = "agentId" WHERE agent_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('investments', {
              fields: ['agent_id'],
              type: 'foreign key',
              name: 'fk_investments_agent_pre',
              references: { table: 'agents', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }

        // approved_by
        if (!investmentsInfo.approved_by) {
          console.log('➕ Adding missing column investments.approved_by');
          await queryInterface.addColumn('investments', 'approved_by', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (investmentsInfo.approvedBy) {
            await queryInterface.sequelize.query('UPDATE investments SET approved_by = "approvedBy" WHERE approved_by IS NULL');
          }
          try {
            await queryInterface.addConstraint('investments', {
              fields: ['approved_by'],
              type: 'foreign key',
              name: 'fk_investments_approved_by_pre',
              references: { table: 'staff', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }

        // date_created
        if (!investmentsInfo.date_created) {
          console.log('➕ Adding missing column investments.date_created');
          await queryInterface.addColumn('investments', 'date_created', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (investmentsInfo.dateCreated) {
            await queryInterface.sequelize.query('UPDATE investments SET date_created = "dateCreated" WHERE date_created IS NULL');
          }
        }

        // interest_rate
        if (!investmentsInfo.interest_rate) {
          console.log('➕ Adding missing column investments.interest_rate');
          await queryInterface.addColumn('investments', 'interest_rate', {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
          });
          if (investmentsInfo.interestRate) {
            await queryInterface.sequelize.query('UPDATE investments SET interest_rate = "interestRate" WHERE interest_rate IS NULL');
          }
        }

        // duration
        if (!investmentsInfo.duration) {
          console.log('➕ Adding missing column investments.duration');
          await queryInterface.addColumn('investments', 'duration', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
        }

        // maturity_date
        if (!investmentsInfo.maturity_date) {
          console.log('➕ Adding missing column investments.maturity_date');
          await queryInterface.addColumn('investments', 'maturity_date', {
            type: DataTypes.DATE,
            allowNull: true,
          });
          if (investmentsInfo.maturityDate) {
            await queryInterface.sequelize.query('UPDATE investments SET maturity_date = "maturityDate" WHERE maturity_date IS NULL');
          }
        }

        // total_return
        if (!investmentsInfo.total_return) {
          console.log('➕ Adding missing column investments.total_return');
          await queryInterface.addColumn('investments', 'total_return', {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
          });
          if (investmentsInfo.totalReturn) {
            await queryInterface.sequelize.query('UPDATE investments SET total_return = "totalReturn" WHERE total_return IS NULL');
          }
        }
      }

      if (walletTxInfo) {
        // merchant_id
        if (!walletTxInfo.merchant_id) {
          console.log('➕ Adding missing column wallet_transactions.merchant_id');
          await queryInterface.addColumn('wallet_transactions', 'merchant_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          if (walletTxInfo.merchantId) {
            await queryInterface.sequelize.query('UPDATE wallet_transactions SET merchant_id = "merchantId" WHERE merchant_id IS NULL');
          }
          try {
            await queryInterface.addConstraint('wallet_transactions', {
              fields: ['merchant_id'],
              type: 'foreign key',
              name: 'fk_wallet_transactions_merchant_pre',
              references: { table: 'merchants', field: 'id' },
              onDelete: 'CASCADE',
            });
          } catch (_) {}
        }

        // processed_by
        if (!walletTxInfo.processed_by) {
          console.log('➕ Adding missing column wallet_transactions.processed_by');
          await queryInterface.addColumn('wallet_transactions', 'processed_by', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
          try {
            await queryInterface.addConstraint('wallet_transactions', {
              fields: ['processed_by'],
              type: 'foreign key',
              name: 'fk_wallet_transactions_processed_by_pre',
              references: { table: 'staff', field: 'id' },
              onDelete: 'SET NULL',
            });
          } catch (_) {}
        }

        // date
        if (!walletTxInfo.date) {
          console.log('➕ Adding missing column wallet_transactions.date');
          await queryInterface.addColumn('wallet_transactions', 'date', {
            type: DataTypes.DATE,
            allowNull: true,
          });
        }

        // description
        if (!walletTxInfo.description) {
          console.log('➕ Adding missing column wallet_transactions.description');
          await queryInterface.addColumn('wallet_transactions', 'description', {
            type: DataTypes.TEXT,
            allowNull: true,
          });
        }

        // reference
        if (!walletTxInfo.reference) {
          console.log('➕ Adding missing column wallet_transactions.reference');
          await queryInterface.addColumn('wallet_transactions', 'reference', {
            type: DataTypes.STRING(255),
            allowNull: true,
          });
        }

        // balance_before
        if (!walletTxInfo.balance_before) {
          console.log('➕ Adding missing column wallet_transactions.balance_before');
          await queryInterface.addColumn('wallet_transactions', 'balance_before', {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
          });
        }

        // balance_after
        if (!walletTxInfo.balance_after) {
          console.log('➕ Adding missing column wallet_transactions.balance_after');
          await queryInterface.addColumn('wallet_transactions', 'balance_after', {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
          });
        }

        // category
        if (!walletTxInfo.category) {
          console.log('➕ Adding missing column wallet_transactions.category');
          await queryInterface.addColumn('wallet_transactions', 'category', {
            type: DataTypes.STRING(100),
            allowNull: true,
          });
        }

        // related_id
        if (!walletTxInfo.related_id) {
          console.log('➕ Adding missing column wallet_transactions.related_id');
          await queryInterface.addColumn('wallet_transactions', 'related_id', {
            type: DataTypes.INTEGER,
            allowNull: true,
          });
        }

        // related_type
        if (!walletTxInfo.related_type) {
          console.log('➕ Adding missing column wallet_transactions.related_type');
          await queryInterface.addColumn('wallet_transactions', 'related_type', {
            type: DataTypes.STRING(100),
            allowNull: true,
          });
        }

        // payment_method
        if (!walletTxInfo.payment_method) {
          console.log('➕ Adding missing column wallet_transactions.payment_method');
          await queryInterface.addColumn('wallet_transactions', 'payment_method', {
            type: DataTypes.STRING(100),
            allowNull: true,
          });
        }

        // notes
        if (!walletTxInfo.notes) {
          console.log('➕ Adding missing column wallet_transactions.notes');
          await queryInterface.addColumn('wallet_transactions', 'notes', {
            type: DataTypes.TEXT,
            allowNull: true,
          });
        }
      }
      console.log('✅ SQL prerequisites ensured');
    } catch (error) {
      console.error('❌ Error ensuring SQL prerequisites:', error);
      throw error;
    }
  },

  down: async (queryInterface) => {
    try {
      let loansInfo = null;
      try {
        loansInfo = await queryInterface.describeTable('loans');
      } catch (_) {}
      if (loansInfo) {
        // Best-effort cleanup of added columns (do not drop if data might be in use)
        try { await queryInterface.removeConstraint('loans', 'fk_loans_customer_id_pre'); } catch (_) {}
        try { await queryInterface.removeConstraint('loans', 'fk_loans_agent_id_pre'); } catch (_) {}
        try { await queryInterface.removeConstraint('loans', 'fk_loans_merchant_id_pre'); } catch (_) {}
        try { await queryInterface.removeConstraint('loans', 'fk_loans_approved_by_pre'); } catch (_) {}
        try { if (loansInfo.customer_id) await queryInterface.removeColumn('loans', 'customer_id'); } catch (_) {}
        try { if (loansInfo.agent_id) await queryInterface.removeColumn('loans', 'agent_id'); } catch (_) {}
        try { if (loansInfo.merchant_id) await queryInterface.removeColumn('loans', 'merchant_id'); } catch (_) {}
        try { if (loansInfo.approved_by) await queryInterface.removeColumn('loans', 'approved_by'); } catch (_) {}
      }
    } catch (error) {
      console.error('❌ Error rolling back SQL prerequisites:', error);
      throw error;
    }
  },
};


