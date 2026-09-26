const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Repayment = sequelize.define('Repayment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    transactionId: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'transaction_id', comment: 'Unique transaction ID' },
    loanId: { type: DataTypes.INTEGER, allowNull: false, field: 'loan_id', references: { model: 'loans', key: 'id' } },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id', references: { model: 'customers', key: 'id' } },
    customerName: { type: DataTypes.STRING, allowNull: false, field: 'customer_name' },
    accountNumber: { type: DataTypes.STRING, allowNull: true, field: 'account_number', comment: 'Customer account number' },
    package: { type: DataTypes.STRING, allowNull: true, comment: 'Loan package name' },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, comment: 'Repayment amount' },
    branch: { type: DataTypes.STRING, allowNull: true, comment: 'Branch where repayment was made' },
    agentId: { type: DataTypes.INTEGER, allowNull: true, field: 'agent_id', references: { model: 'agents', key: 'id' } },
    agentName: { type: DataTypes.STRING, allowNull: true, field: 'agent_name', comment: 'Agent who processed the repayment' },
    merchantId: { type: DataTypes.INTEGER, allowNull: false, field: 'merchant_id', references: { model: 'merchants', key: 'id' } },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.STRING, defaultValue: 'Pending' },
    paymentMethod: { type: DataTypes.STRING, allowNull: true, field: 'payment_method', comment: 'Method of payment' },
    reference: { type: DataTypes.STRING, allowNull: true, comment: 'Payment reference number' },
    notes: { type: DataTypes.TEXT, allowNull: true, comment: 'Additional notes' }
  }, {
    tableName: 'repayments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['merchant_id'] },
      { fields: ['loan_id'] },
      { fields: ['customer_id'] },
      { fields: ['date'] },
      { fields: ['status'] },
      { fields: ['transaction_id'] }
    ]
  });

  Repayment.associate = (models) => {
    Repayment.belongsTo(models.Loan, { foreignKey: 'loanId', as: 'loan' });
    Repayment.belongsTo(models.Customer, { foreignKey: 'customerId', as: 'customer' });
    Repayment.belongsTo(models.Agent, { foreignKey: 'agentId', as: 'agent' });
    Repayment.belongsTo(models.Merchant, { foreignKey: 'merchantId', as: 'merchant' });
  };

  return Repayment;
};
