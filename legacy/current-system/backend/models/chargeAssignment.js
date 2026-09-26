module.exports = (sequelize, DataTypes) => {
  const ChargeAssignment = sequelize.define('ChargeAssignment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    chargeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'charge_id'
    },
    customerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'customer_id'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'due_date'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Paid', 'Overdue'),
      defaultValue: 'Pending'
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'merchant_id'
    },
    dateApplied: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'date_applied'
    },
    datePaid: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'date_paid'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at'
    }
  }, {
    tableName: 'charge_assignments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return ChargeAssignment;
};
