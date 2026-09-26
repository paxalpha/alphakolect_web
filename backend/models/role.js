module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    roleName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cantView: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    canViewOnly: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    canEdit: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    permissions: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
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
    tableName: 'roles',
    timestamps: true,
  });

  Role.associate = (models) => {
    if (models.Merchant) {
      Role.belongsTo(models.Merchant, { foreignKey: 'merchantId' });
    }
    if (models.Staff) {
      Role.hasMany(models.Staff, { foreignKey: 'roleId' });
    }
  };

  return Role;
};
