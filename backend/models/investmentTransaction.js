const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const InvestmentTransaction = sequelize.define('InvestmentTransaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    customerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'customer_id',
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
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'account_number',
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
    transactionType: {
      type: DataTypes.ENUM('deposit', 'withdrawal', 'interest', 'penalty'),
      allowNull: false,
      field: 'transaction_type',
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
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'merchant_id',
      references: {
        model: 'merchants',
        key: 'id'
      }
    },
    transactionDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'transaction_date',
      comment: 'Date when transaction occurred'
    }
  }, {
    tableName: 'investment_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['customer_id']
      },
      {
        fields: ['merchant_id']
      },
      {
        fields: ['transaction_type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['transaction_date']
      }
    ]
  });

  return InvestmentTransaction;
};
