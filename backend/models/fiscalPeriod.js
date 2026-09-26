module.exports = (sequelize, DataTypes) => {
  const FiscalPeriod = sequelize.define('FiscalPeriod', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('open', 'closed'),
      defaultValue: 'open',
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
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
    tableName: 'fiscal_periods',
    timestamps: true,
  });

  FiscalPeriod.associate = (models) => {
    FiscalPeriod.belongsTo(models.Merchant, { foreignKey: 'merchantId' });
  };

  return FiscalPeriod;
};
