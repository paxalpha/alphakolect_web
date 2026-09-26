module.exports = (sequelize, DataTypes) => {
  const WalletUpgradeRequest = sequelize.define('WalletUpgradeRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    currentLevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    targetLevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending',
    },
    documents: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reviewedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'wallet_upgrade_requests',
    timestamps: true,
  });

  return WalletUpgradeRequest;
};
