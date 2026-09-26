const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('investment_transactions', {
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
      customer: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Customer name'
      },
      account_number: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Customer account number'
      },
      package: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Investment package name'
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: 'Transaction amount'
      },
      branch: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Branch where transaction occurred'
      },
      agent: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Agent handling the transaction'
      },
      transaction_type: {
        type: DataTypes.ENUM('deposit', 'withdrawal', 'interest', 'penalty'),
        allowNull: false,
        comment: 'Type of investment transaction'
      },
      status: {
        type: DataTypes.ENUM('pending', 'completed', 'cancelled'),
        defaultValue: 'pending',
        comment: 'Transaction status'
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Additional transaction notes'
      },
      merchant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        }
      },
      transaction_date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: 'Date when transaction occurred'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Add indexes
    await queryInterface.addIndex('investment_transactions', ['customer_id']);
    await queryInterface.addIndex('investment_transactions', ['merchant_id']);
    await queryInterface.addIndex('investment_transactions', ['transaction_type']);
    await queryInterface.addIndex('investment_transactions', ['status']);
    await queryInterface.addIndex('investment_transactions', ['transaction_date']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('investment_transactions');
  }
};
