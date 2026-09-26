module.exports = (sequelize, DataTypes) => {
  const AdminRole = sequelize.define('AdminRole', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true
      }
    },
    permissions: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: false,
      defaultValue: []
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'admin_roles',
    timestamps: true,
    underscored: true
  });

  AdminRole.associate = (models) => {
    AdminRole.hasMany(models.AdminStaff, {
      foreignKey: 'roleId',
      as: 'staff'
    });
  };

  return AdminRole;
};
