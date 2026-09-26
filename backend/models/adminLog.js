module.exports = (sequelize, DataTypes) => {
  const AdminLog = sequelize.define('AdminLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    staffId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'admin_staff',
        key: 'id'
      }
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false
    },
    entity: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'The entity type affected (e.g., merchant, transaction, plan)'
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'The ID of the affected entity'
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'admin_logs',
    timestamps: true,
    underscored: true
  });

  AdminLog.associate = (models) => {
    AdminLog.belongsTo(models.AdminStaff, {
      foreignKey: 'staffId',
      as: 'staff'
    });
  };

  return AdminLog;
};
