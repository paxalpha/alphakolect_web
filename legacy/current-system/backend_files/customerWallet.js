const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerWallet = sequelize.define('CustomerWallet', {
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
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'merchant_id',
      references: {
        model: 'merchants',
        key: 'id'
      }
    },
    accountNumber: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      field: 'account_number',
      comment: 'Unique wallet account number for the customer'
    },
    accountLevel: {
      type: DataTypes.STRING(20),
      defaultValue: 'Tier 1',
      field: 'account_level',
      comment: 'Account tier level (Tier 1, Tier 2, Tier 3, etc.)'
    },
    status: {
      type: DataTypes.ENUM('Active', 'Suspended', 'Closed'),
      defaultValue: 'Active',
      comment: 'Wallet status'
    },
    lastTransactionDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_transaction_date',
      comment: 'Date of last transaction'
    },
    activationDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'activation_date',
      comment: 'Date when wallet was activated'
    },
    dailyLimit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 1000000.00,
      field: 'daily_limit',
      comment: 'Daily transaction limit'
    },
    monthlyLimit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 10000000.00,
      field: 'monthly_limit',
      comment: 'Monthly transaction limit'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes about the wallet'
    }
  }, {
    tableName: 'customer_wallets',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      beforeCreate: (wallet) => {
        // Generate account number if not provided
        if (!wallet.accountNumber) {
          wallet.accountNumber = `CW${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        }
      }
    }
  });

  CustomerWallet.associate = (models) => {
    // CustomerWallet belongs to Customer
    CustomerWallet.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    // CustomerWallet belongs to Merchant
    CustomerWallet.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });
  };

  return CustomerWallet;
};
