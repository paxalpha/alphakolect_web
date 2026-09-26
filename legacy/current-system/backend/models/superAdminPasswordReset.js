// Single-use password reset tokens for super admins (migrations/046_super_admin_password_resets.sql).
// Only sha256(token) is stored; the raw token exists only in the emailed link.
module.exports = (sequelize, DataTypes) => {
  const SuperAdminPasswordReset = sequelize.define('SuperAdminPasswordReset', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    superAdminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'super_admins',
        key: 'id'
      }
    },
    tokenHash: {
      type: DataTypes.CHAR(64),
      allowNull: false,
      unique: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    requestedIp: {
      type: DataTypes.STRING(64),
      allowNull: true
    }
  }, {
    tableName: 'super_admin_password_resets',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    underscored: true
  });

  SuperAdminPasswordReset.associate = (models) => {
    SuperAdminPasswordReset.belongsTo(models.SuperAdmin, { foreignKey: 'superAdminId' });
  };

  return SuperAdminPasswordReset;
};
