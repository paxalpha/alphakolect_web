const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const InvestmentApplication = sequelize.define('InvestmentApplication', {
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
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'customer_name'
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'account_number',
      comment: 'Customer account number'
    },
    targetAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      field: 'target_amount',
      comment: 'Target investment amount'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Duration in days'
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'agent_id',
      references: {
        model: 'agents',
        key: 'id'
      }
    },
    agentName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'agent_name',
      comment: 'Agent handling the application'
    },
    branch: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Branch where application was submitted'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Completed', 'Closed'),
      defaultValue: 'Pending'
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
    dateApplied: {
      type: DataTypes.DATE,
      field: 'date_applied',
      defaultValue: DataTypes.NOW
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes or comments'
    },
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'approved_by',
      references: {
        model: 'staff',
        key: 'id'
      }
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'approved_at'
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'rejection_reason',
      comment: 'Reason for rejection if applicable'
    }
  }, {
    tableName: 'investment_applications',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['merchantId']
      },
      {
        fields: ['customerId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['dateApplied']
      }
    ]
  });

  InvestmentApplication.associate = (models) => {
    InvestmentApplication.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });
    
    InvestmentApplication.belongsTo(models.Agent, {
      foreignKey: 'agentId',
      as: 'agent'
    });
    
    InvestmentApplication.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });
    
    InvestmentApplication.belongsTo(models.Staff, {
      foreignKey: 'approvedBy',
      as: 'approver'
    });
  };

  return InvestmentApplication;
};
