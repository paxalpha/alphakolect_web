const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Collection = sequelize.define('Collection', {
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
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Amount to be collected'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'due_date',
      comment: 'Date when collection is due'
    },
    type: {
      type: DataTypes.ENUM('Loan Repayment', 'Savings Collection', 'Investment Return', 'Package Payment', 'Other'),
      allowNull: false,
      comment: 'Type of collection'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Collected', 'Overdue', 'Partial', 'Cancelled', 'Deleted'),
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
    dateCreated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'date_created'
    },
    collectedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'collected_date',
      comment: 'Date when collection was actually made'
    },
    amountCollected: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: 'amount_collected',
      comment: 'Actual amount collected (may differ from expected amount)'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes about the collection'
    },
    collectionNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'collection_notes',
      comment: 'Notes added when collection is made'
    },
    priority: {
      type: DataTypes.ENUM('Low', 'Medium', 'High', 'Urgent'),
      defaultValue: 'Medium'
    },
    reminderSent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'reminder_sent',
      comment: 'Whether reminder has been sent to customer'
    },
    reminderDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reminder_date',
      comment: 'Date when last reminder was sent'
    },
    cycle: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 31,
      comment: 'Total cycle days (always 31)'
    },
    cycleCounter: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: 'cycle_counter',
      comment: 'Current day in cycle (1-31)'
    },
    packageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'package_id',
      references: {
        model: 'packages',
        key: 'id'
      },
      comment: 'Reference to collection package'
    },
    packageName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'package_name',
      comment: 'Collection package name'
    },
    packageAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: 'package_amount',
      comment: 'Package amount for autofill'
    },
    isFirstCollection: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_first_collection',
      comment: 'Whether this is the first collection of the 31-day cycle'
    }
  }, {
    tableName: 'collections',
    timestamps: false,
    hooks: {
      beforeUpdate: (collection) => {
        // Auto-set collected date when status changes to Collected
        if (collection.changed('status') && collection.status === 'Collected' && !collection.collectedDate) {
          collection.collectedDate = new Date();
        }
        
        // Set amount collected to expected amount if not specified
        if (collection.status === 'Collected' && !collection.amountCollected) {
          collection.amountCollected = collection.amount;
        }
        
        // Update priority based on due date
        const today = new Date();
        const dueDate = new Date(collection.dueDate);
        const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysDiff < 0) {
          collection.priority = 'Urgent';
          if (collection.status === 'Pending') {
            collection.status = 'Overdue';
          }
        } else if (daysDiff <= 3) {
          collection.priority = 'High';
        } else if (daysDiff <= 7) {
          collection.priority = 'Medium';
        } else {
          collection.priority = 'Low';
        }
      }
    }
  });

  Collection.associate = (models) => {
    // Collection belongs to Customer
    Collection.belongsTo(models.Customer, {
      foreignKey: 'customerId',
      as: 'customer'
    });

    // Collection belongs to Merchant
    Collection.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });
  };

  return Collection;
};
