module.exports = (sequelize, DataTypes) => {
  const Customer = sequelize.define('Customer', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'full_name',
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'phone_number',
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      field: 'account_number',
    },
    alias: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'agent_id',
    },
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'branch_id',
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'merchant_id',
    },
    packageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'package_id',
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  }, {
    tableName: 'customers',
    timestamps: true,
  });

  Customer.associate = (models) => {
    Customer.hasMany(models.InvestmentApplication, { foreignKey: 'customerId' });
    Customer.hasMany(models.LoanApplication, { foreignKey: 'customerId' });
    Customer.hasMany(models.CustomerWallet, { foreignKey: 'customerId', as: 'customer' });
  };

  return Customer;
};
