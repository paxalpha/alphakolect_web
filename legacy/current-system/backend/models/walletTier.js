module.exports = (sequelize, DataTypes) => {
  const WalletTier = sequelize.define('WalletTier', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dailyLimit: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    maxBalance: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    fee: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    requirements: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  }, {
    tableName: 'wallet_tiers',
    timestamps: true,
  });

  return WalletTier;
};
