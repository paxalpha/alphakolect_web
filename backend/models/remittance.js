const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Remittance = sequelize.define('Remittance', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    collectionId: { type: DataTypes.INTEGER, allowNull: true, field: 'collection_id' },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id' },
    customerName: { type: DataTypes.STRING, allowNull: false, field: 'customer_name' },
    accountNumber: { type: DataTypes.STRING, allowNull: true, field: 'account_number' },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    agentId: { type: DataTypes.INTEGER, allowNull: true, field: 'agent_id' },
    agentName: { type: DataTypes.STRING, allowNull: true, field: 'agent_name' },
    merchantId: { type: DataTypes.INTEGER, allowNull: false, field: 'merchant_id' },
    status: { type: DataTypes.ENUM('Pending', 'Approved', 'Rejected'), defaultValue: 'Pending' },
    notes: { type: DataTypes.TEXT, allowNull: true },
    source: { 
      type: DataTypes.ENUM('Mobile', 'Web', 'API'), 
      defaultValue: 'Web',
      allowNull: false 
    },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: 'approved_at' }
  }, {
    tableName: 'remittances',
    timestamps: true,
    underscored: true
  });

  Remittance.associate = (models) => {
    Remittance.belongsTo(models.Merchant, { foreignKey: 'merchantId', as: 'merchant' });
    Remittance.belongsTo(models.Customer, { foreignKey: 'customerId', as: 'customer' });
    Remittance.belongsTo(models.Agent, { foreignKey: 'agentId', as: 'agent' });
  };

  return Remittance;
};


