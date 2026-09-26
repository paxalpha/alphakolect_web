module.exports = (sequelize, DataTypes) => {
  const Activity = sequelize.define('Activity', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    staffId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    person: {
      type: DataTypes.ENUM('merchant', 'agent', 'staff'),
      allowNull: false,
    },

    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'activities',
    timestamps: true,
  });

  Activity.associate = (models) => {
    Activity.belongsTo(models.Merchant, { foreignKey: 'merchantId' });
    Activity.belongsTo(models.Agent, { foreignKey: 'agentId' });
    Activity.belongsTo(models.Staff, { foreignKey: 'staffId' });
  };

  return Activity;
};
