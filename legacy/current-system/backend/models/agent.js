module.exports = (sequelize, DataTypes) => {
  const Agent = sequelize.define('Agent', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'full_name',
      defaultValue: 'Unknown',
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'phone_number',
    },
    branch: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'merchant_id',
    },
    
    
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  }, {
    tableName: 'agents',
    timestamps: true,
  });

  Agent.associate = (models) => {
    Agent.hasMany(models.InvestmentApplication, { foreignKey: 'agentId' });
    Agent.hasMany(models.LoanApplication, { foreignKey: 'agentId' });
  };

  return Agent;
};
