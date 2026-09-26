'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create accounts table
    await queryInterface.createTable('accounts', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'),
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      balance: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0,
      },
      currency: {
        type: Sequelize.STRING,
        defaultValue: 'NGN',
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Add unique constraint on code per merchant
    await queryInterface.addIndex('accounts', ['code', 'merchantId'], {
      unique: true,
      name: 'accounts_code_merchantId_unique'
    });

    // Create journal_entries table
    await queryInterface.createTable('journal_entries', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      reference: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      totalDebit: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0,
      },
      totalCredit: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0,
      },
      status: {
        type: Sequelize.ENUM('draft', 'posted', 'reversed'),
        defaultValue: 'draft',
      },
      attachments: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      reversedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Create journal_lines table
    await queryInterface.createTable('journal_lines', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      journalEntryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'journal_entries',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      accountId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'accounts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      debit: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0,
      },
      credit: {
        type: Sequelize.DECIMAL(15, 2),
        defaultValue: 0,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Create fiscal_periods table
    await queryInterface.createTable('fiscal_periods', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      startDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      endDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('open', 'closed'),
        defaultValue: 'open',
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    console.log('✅ Accounting tables created successfully');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('journal_lines');
    await queryInterface.dropTable('journal_entries');
    await queryInterface.dropTable('fiscal_periods');
    await queryInterface.dropTable('accounts');
    console.log('✅ Accounting tables dropped successfully');
  }
};
