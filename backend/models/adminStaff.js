module.exports = (sequelize, DataTypes) => {
  const AdminStaff = sequelize.define('AdminStaff', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    roleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'admin_roles',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      defaultValue: 'active'
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true
    },
    profileImage: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'admin_staff',
    timestamps: true,
    underscored: true
  });

  AdminStaff.associate = (models) => {
    AdminStaff.belongsTo(models.AdminRole, {
      foreignKey: 'roleId',
      as: 'role'
    });
  };

  return AdminStaff;
};
