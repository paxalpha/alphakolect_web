const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoanApplication = sequelize.define('LoanApplication', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    customerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Customer account number'
    },
    requestedAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Requested loan amount'
    },
    interestRate: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Interest rate percentage or flat interest amount'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Duration in days'
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'agents',
        key: 'id'
      }
    },
    agentName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Agent handling the application'
    },
    branch: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Branch where application was submitted'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Completed'),
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
      references: {
        model: 'staff',
        key: 'id'
      }
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for rejection if applicable'
    },
    purpose: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Purpose of the loan'
    },
    collateral: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Collateral information if any'
    },
    packageName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'package_name',
      comment: 'Selected loan package name'
    }
  }, {
    tableName: 'loan_applications',
    timestamps: true,
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

  LoanApplication.associate = (models) => {
    LoanApplication.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });
    
    LoanApplication.belongsTo(models.Agent, {
      foreignKey: 'agentId',
      as: 'agent'
    });
    
    LoanApplication.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });
    
    LoanApplication.belongsTo(models.Staff, {
      foreignKey: 'approvedBy',
      as: 'approver'
    });
  };

  return LoanApplication;
};
