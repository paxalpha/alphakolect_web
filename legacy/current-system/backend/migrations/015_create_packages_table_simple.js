const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Creating packages table with all fields (simplified)...');
      
      // Create packages table with all columns (without foreign key constraints) (idempotent)
      const alreadyExists = await queryInterface.sequelize.query(
        "SELECT to_regclass('public.packages') as exists;",
        { type: Sequelize.QueryTypes.SELECT }
      );
      if (!alreadyExists[0] || !alreadyExists[0].exists) {
        await queryInterface.createTable('packages', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          comment: 'Package name (e.g., Alpha 1K, Beta 2K)'
        },
        type: {
          type: DataTypes.ENUM('Fixed', 'Variable', 'Flexible'),
          allowNull: false,
          defaultValue: 'Fixed',
          comment: 'Package type: Fixed, Variable, or Flexible'
        },
        amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false,
          comment: 'Package amount/price'
        },
        seedAmount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: true,
          comment: 'Initial seed amount or percentage for the package'
        },
        seedType: {
          type: DataTypes.STRING,
          allowNull: true,
          comment: 'Type of seed (e.g., First saving, Bonus, etc.)'
        },
        period: {
          type: DataTypes.INTEGER,
          allowNull: false,
          comment: 'Period in days for the package'
        },
        collectionDays: {
          type: DataTypes.ENUM('Daily', 'Weekly', 'Monthly', 'Custom'),
          allowNull: false,
          defaultValue: 'Daily',
          comment: 'How often collections are made'
        },
        duration: {
          type: DataTypes.INTEGER,
          allowNull: false,
          comment: 'Duration in days'
        },
        benefits: {
          type: DataTypes.JSON,
          allowNull: true,
          comment: 'Array of package benefits'
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
          comment: 'Detailed package description'
        },
        status: {
          type: DataTypes.ENUM('Active', 'Inactive', 'Deleted'),
          defaultValue: 'Active'
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          comment: 'Reference to merchant who owns this package'
        },
        dateCreated: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        maxCustomers: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: 'Maximum number of customers for this package'
        },
        currentCustomers: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
          comment: 'Current number of customers enrolled'
        },
        interestRate: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          comment: 'Interest rate for savings in this package'
        },
        minimumSavings: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: true,
          comment: 'Minimum daily/weekly savings amount'
        },
        savingsFrequency: {
          type: DataTypes.ENUM('Daily', 'Weekly', 'Monthly'),
          defaultValue: 'Daily',
          comment: 'How often customers need to save'
        },
        extraCharges: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0.00,
          comment: 'Additional charges for the package'
        },
        defaultPenalty: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0.00,
          comment: 'Default penalty amount per day'
        },
        defaultDays: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
          comment: 'Default number of days for penalties'
        },
        // Loan-specific fields
        loanAmount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: true,
          comment: 'Loan amount for loan packages'
        },
        loanInterestRate: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          comment: 'Interest rate for loan packages'
        },
        loanPeriod: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: 'Loan period in days'
        },
        defaultAmount: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0.00,
          comment: 'Default amount for loan packages'
        },
        gracePeriod: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
          comment: 'Grace period in days for loan packages'
        },
        loanCharges: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0.00,
          comment: 'Additional charges for loan packages'
        },
        packageCategory: {
          type: DataTypes.ENUM('Investment', 'Loan', 'Collection'),
          defaultValue: 'Investment',
          comment: 'Package category: Investment, Loan, or Collection'
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
        });
      }

      // Add indexes for better performance
      try { await queryInterface.addIndex('packages', ['merchantId'], { name: 'idx_packages_merchant_id' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['status'], { name: 'idx_packages_status' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['type'], { name: 'idx_packages_type' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['amount'], { name: 'idx_packages_amount' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['packageCategory'], { name: 'idx_packages_category' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['loanAmount'], { name: 'idx_packages_loan_amount' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      try { await queryInterface.addIndex('packages', ['loanPeriod'], { name: 'idx_packages_loan_period' }); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }

      console.log('Successfully created packages table with all fields');
    } catch (error) {
      console.error('Error creating packages table:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Dropping packages table...');
      await queryInterface.dropTable('packages');
      console.log('Successfully dropped packages table');
    } catch (error) {
      console.error('Error dropping packages table:', error);
      throw error;
    }
  }
};
