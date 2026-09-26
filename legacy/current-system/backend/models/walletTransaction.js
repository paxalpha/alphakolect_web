const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WalletTransaction = sequelize.define('WalletTransaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    transactionType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'transaction_type',
      comment: 'Business transaction type (e.g., payment, refund, loan, investment)'
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
    type: {
      type: DataTypes.ENUM('credit', 'debit', 'transfer'),
      allowNull: false,
      comment: 'Type of wallet transaction'
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Transaction amount'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Transaction description'
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: 'Unique transaction reference'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
      defaultValue: 'Completed'
    },
    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Transaction date'
    },
    balanceBefore: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: 'balance_before',
      comment: 'Wallet balance before transaction'
    },
    balanceAfter: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: 'balance_after',
      comment: 'Wallet balance after transaction'
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Transaction category (e.g., loan_repayment, collection, etc.)'
    },
    relatedId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'related_id',
      comment: 'ID of related record (loan, collection, etc.)'
    },
    relatedType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'related_type',
      comment: 'Type of related record (loan, collection, etc.)'
    },
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'payment_method',
      comment: 'Payment method used'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes about the transaction'
    },
    processedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'processed_by',
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID of user who processed the transaction'
    }
  }, {
    tableName: 'wallet_transactions',
    timestamps: false,
    hooks: {
      beforeCreate: (transaction) => {
        // Generate reference if not provided
        if (!transaction.reference) {
          transaction.reference = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
      }
    }
  });

  WalletTransaction.associate = (models) => {
    // WalletTransaction belongs to Merchant
    WalletTransaction.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });

    // WalletTransaction can be processed by a User (staff/admin)
    WalletTransaction.belongsTo(models.User, {
      foreignKey: 'processedBy',
      as: 'processor'
    });
  };

  return WalletTransaction;
};
