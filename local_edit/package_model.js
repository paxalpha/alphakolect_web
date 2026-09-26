const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Package = sequelize.define('Package', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Package name (e.g., Alpha 1K, Beta 2K)'
    },
    type: {
      type: DataTypes.ENUM('Fixed', 'Variable', 'Flexible'),
      allowNull: false,
      defaultValue: 'Fixed',
      comment: 'Package type: Fixed, Variable, or Flexible'
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      comment: 'Package amount/price'
    },
    seedAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      comment: 'Initial seed amount or percentage for the package'
    },
    seedType: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Type of seed (e.g., First saving, Bonus, etc.)'
    },
    period: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Period in days for the package'
    },
    collectionDays: {
      type: DataTypes.ENUM('Daily', 'Weekly', 'Monthly', 'Custom'),
      allowNull: false,
      defaultValue: 'Daily',
      comment: 'How often collections are made'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Duration in days'
    },
    benefits: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array of package benefits'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Detailed package description'
    },
    status: {
      type: DataTypes.ENUM('Active', 'Inactive', 'Deleted'),
      defaultValue: 'Active'
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
      defaultValue: DataTypes.NOW
    },
    maxCustomers: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Maximum number of customers for this package'
    },
    currentCustomers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Current number of customers enrolled'
    },
    interestRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Interest rate for savings in this package'
    },
    minimumSavings: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      comment: 'Minimum daily/weekly savings amount'
    },
    savingsFrequency: {
      type: DataTypes.ENUM('Daily', 'Weekly', 'Monthly'),
      defaultValue: 'Daily',
      comment: 'How often customers need to save'
    },
    extraCharges: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      comment: 'Additional charges for the package'
    },
    defaultPenalty: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      comment: 'Default penalty amount per day'
    },
    defaultDays: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Default number of days for penalties'
    },
    defaultPercentageRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Default percentage rate for missed day penalty calculation'
    },
    // Loan-specific fields
    loanAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      comment: 'Loan amount for loan packages'
    },
    loanInterestRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Interest rate for loan packages'
    },
    interestAmount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      comment: 'Fixed interest amount in Naira for flat rate loan packages'
    },
    loanPeriod: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Loan period in days'
    },
    defaultAmount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      comment: 'Default amount for loan packages'
    },
    gracePeriod: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Grace period in days for loan packages'
    },
    loanCharges: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0.00,
      comment: 'Additional charges for loan packages'
    },
    packageCategory: {
      type: DataTypes.ENUM('Investment', 'Loan', 'Collection'),
      defaultValue: 'Investment',
      comment: 'Package category: Investment, Loan, or Collection'
    }
  }, {
    tableName: 'packages',
    timestamps: true,
    hooks: {
      beforeCreate: (packageData) => {
        // Set default benefits if not provided
        if (!packageData.benefits || packageData.benefits.length === 0) {
          packageData.benefits = ['Daily savings', 'Low interest loans'];
        }
        
        // Set default interest rate based on package amount
        if (!packageData.interestRate) {
          const amount = parseFloat(packageData.amount);
          if (amount >= 5000) {
            packageData.interestRate = 15.0;
          } else if (amount >= 2000) {
            packageData.interestRate = 12.0;
          } else {
            packageData.interestRate = 10.0;
          }
        }
        
        // Set default minimum savings (10% of package amount)
        if (!packageData.minimumSavings) {
          packageData.minimumSavings = parseFloat(packageData.amount) * 0.1;
        }

        // Set default seed amount if not provided
        if (!packageData.seedAmount) {
          packageData.seedAmount = parseFloat(packageData.amount);
        }

        // Set default seed type if not provided
        if (!packageData.seedType) {
          packageData.seedType = 'First saving';
        }

        // Set default period if not provided
        if (!packageData.period) {
          packageData.period = packageData.duration || 360;
        }

        // Set default extra charges if not provided
        if (!packageData.extraCharges) {
          packageData.extraCharges = 0.00;
        }

        // Set default penalty if not provided
        if (!packageData.defaultPenalty) {
          packageData.defaultPenalty = 0.00;
        }

        // Set default days if not provided
        if (!packageData.defaultDays) {
          packageData.defaultDays = 0;
        }

        // Set default loan charges if not provided
        if (!packageData.loanCharges) {
          packageData.loanCharges = 0.00;
        }

        // Set default grace period if not provided
        if (!packageData.gracePeriod) {
          packageData.gracePeriod = 0;
        }

        // Set default amount if not provided
        if (!packageData.defaultAmount) {
          packageData.defaultAmount = 0.00;
        }

        // Set package category if not provided
        if (!packageData.packageCategory) {
          packageData.packageCategory = 'Investment';
        }
      }
    }
  });

  Package.associate = (models) => {
    // Package belongs to Merchant
    Package.belongsTo(models.Merchant, {
      foreignKey: 'merchantId',
      as: 'merchant'
    });

    // Package can have many customer subscriptions (if you add a subscription model later)
    // Package.hasMany(models.PackageSubscription, {
    //   foreignKey: 'packageId',
    //   as: 'subscriptions'
    // });
  };

  return Package;
};
