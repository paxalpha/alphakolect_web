module.exports = (sequelize, DataTypes) => {
  const Merchant = sequelize.define('Merchant', {
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
    wallet_balance: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    wallet_status: {
      type: DataTypes.STRING,
      defaultValue: 'Active',
    },
    subscription_status: {
      type: DataTypes.STRING,
      defaultValue: 'Active',
    },
    plan_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    total_debt: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    sms_balance: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    trial_end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_billing_date: {
      type: DataTypes.DATE,
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
  }, {
    tableName: 'merchants',
    timestamps: true,
    underscored: false,
  });

  Merchant.associate = (models) => {
    Merchant.hasMany(models.InvestmentApplication, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.LoanApplication, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.CustomerWallet, { foreignKey: 'merchantId' });
    Merchant.hasMany(models.Agent, { foreignKey: 'merchantId', as: 'agents' });
    Merchant.hasMany(models.Customer, { foreignKey: 'merchantId', as: 'customers' });
  };

  return Merchant;
};
