const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SuperAdmin = sequelize.define('SuperAdmin', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Full name of the super admin'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      },
      comment: 'Unique email address of the super admin'
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Hashed password'
    },
    role: {
      type: DataTypes.ENUM('superadmin', 'admin'),
      allowNull: false,
      defaultValue: 'superadmin',
      comment: 'Role of the admin (superadmin or admin)'
    }
  }, {
    tableName: 'super_admins',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true
  });

  SuperAdmin.associate = (models) => {
    // Example: if later super admins manage merchants, users, etc.
    // SuperAdmin.hasMany(models.Merchant, { foreignKey: 'createdBy', as: 'merchants' });
  };

  return SuperAdmin;
};
