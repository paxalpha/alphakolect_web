module.exports = (sequelize, DataTypes) => {
  console.log("MARKER: Loading Merchant Model"); const Merchant = sequelize.define('Merchant', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    businessName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    businessAlias: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    otp: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    otpExpires: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    accountLevel: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'Tier 0',
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accountName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    subscriptionStatus: {
      field: 'subscription_status',
      type: DataTypes.ENUM('Active', 'Grace', 'Suspended', 'Blocked'),
      defaultValue: 'Active',
    },
    planId: {
      field: 'plan_id',
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'plans',
        key: 'id',
      },
    },
    isCustomFee: {
      field: 'is_custom_fee',
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    customFee: {
      field: 'custom_fee',
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    nextBillingDate: {
      field: 'next_billing_date',
      type: DataTypes.DATE,
      allowNull: true,
    },
    totalDebt: {
      field: 'total_debt',
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    trialEndDate: {
      field: 'trial_end_date',
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'merchants',
    timestamps: true,
  });

  Merchant.associate = (models) => {
    Merchant.hasMany(models.InvestmentApplication, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.LoanApplication, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.CustomerWallet, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.Agent, { foreignKey: 'merchantId', as: 'agents' });
    Merchant.hasMany(models.Customer, { foreignKey: 'merchantId', as: 'customers' });
    Merchant.belongsTo(models.Plan, { foreignKey: 'planId', as: 'plan' });
  };

  return Merchant;
};
