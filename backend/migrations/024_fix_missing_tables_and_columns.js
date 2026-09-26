const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('🔧 Fixing missing tables and columns...');
      
      // 1. Create investment_applications table
      console.log('📦 Creating investment_applications table...');
      await queryInterface.createTable('investment_applications', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        customer_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'customers',
            key: 'id'
          }
        },
        customer_name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        account_number: {
          type: DataTypes.STRING,
          allowNull: true
        },
        target_amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        duration: {
          type: DataTypes.INTEGER,
          allowNull: false
        },
        agent_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'agents',
            key: 'id'
          }
        },
        agent_name: {
          type: DataTypes.STRING,
          allowNull: true
        },
        branch: {
          type: DataTypes.STRING,
          allowNull: true
        },
        status: {
          type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Completed'),
          defaultValue: 'Pending'
        },
        merchant_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        date_applied: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        approved_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'staff',
            key: 'id'
          }
        },
        approved_at: {
          type: DataTypes.DATE,
          allowNull: true
        },
        rejection_reason: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        created_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updated_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Add indexes for investment_applications (idempotent)
      const indexes = [
        { name: 'investment_applications_merchant_id', fields: ['merchant_id'] },
        { name: 'investment_applications_customer_id', fields: ['customer_id'] },
        { name: 'investment_applications_agent_id', fields: ['agent_id'] },
        { name: 'investment_applications_status', fields: ['status'] },
        { name: 'investment_applications_date_applied', fields: ['date_applied'] },
      ];
      for (const idx of indexes) {
        try {
          await queryInterface.addIndex('investment_applications', idx.fields, { name: idx.name });
        } catch (e) {
          if (String(e.message).includes('already exists')) {
            console.log(`  ⚠️  Skipping existing index ${idx.name}`);
          } else {
            throw e;
          }
        }
      }

      // 2. Add missing columns to loans table
      console.log('📦 Adding missing columns to loans table...');
      
      // Check if customer_id column exists, if not add it
      const loansTableInfo = await queryInterface.describeTable('loans');
      if (!loansTableInfo.customer_id) {
        await queryInterface.addColumn('loans', 'customer_id', {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'customers',
            key: 'id'
          }
        });
      }

      // Check if amount_paid column exists, if not add it
      if (!loansTableInfo.amount_paid) {
        await queryInterface.addColumn('loans', 'amount_paid', {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0,
          allowNull: false
        });
      }

      // 3. Add missing columns to repayments table
      console.log('📦 Adding missing columns to repayments table...');
      
      // Check if customer_id column exists, if not add it
      const repaymentsTableInfo = await queryInterface.describeTable('repayments');
      if (!repaymentsTableInfo.customer_id) {
        await queryInterface.addColumn('repayments', 'customer_id', {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'customers',
            key: 'id'
          }
        });
      }

      console.log('✅ Successfully fixed missing tables and columns');
    } catch (error) {
      console.error('❌ Error fixing missing tables and columns:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('🔄 Rolling back missing tables and columns fixes...');
      
      // Drop investment_applications table
      await queryInterface.dropTable('investment_applications');
      
      // Remove added columns from loans table
      await queryInterface.removeColumn('loans', 'customer_id');
      await queryInterface.removeColumn('loans', 'amount_paid');
      
      // Remove added columns from repayments table
      await queryInterface.removeColumn('repayments', 'customer_id');
      
      console.log('✅ Successfully rolled back changes');
    } catch (error) {
      console.error('❌ Error rolling back changes:', error);
      throw error;
    }
  }
};
