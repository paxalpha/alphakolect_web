module.exports = (sequelize, DataTypes) => {
  const Plan = sequelize.define('Plan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('standard', 'custom'),
      allowNull: false,
      defaultValue: 'standard'
    },
    billingCycle: {
      type: DataTypes.ENUM('monthly', 'yearly'),
      allowNull: false,
      defaultValue: 'monthly',
      field: 'billing_cycle'
    },
    pricing: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'NGN'
    },
    features: {
      type: DataTypes.JSON,
      allowNull: true
    },
    maxAgents: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'max_agents'
    },
    maxCustomers: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'max_customers'
    },
    maxTransactions: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'max_transactions'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'merchant_id',
      references: {
        model: 'merchants',
        key: 'id'
      }
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
    tableName: 'plans',
    timestamps: true,
    underscored: true
  });

  Plan.associate = (models) => {
    // Plan belongs to a Merchant (for custom plans)
    Plan.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });
  };

  return Plan;
};
