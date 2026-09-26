module.exports = (sequelize, DataTypes) => {
  const SupportTicket = sequelize.define('SupportTicket', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    ticketId: { 
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: 'ticket_id'
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'merchant_id'
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Others'
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      defaultValue: 'medium'
    },
    status: {
      type: DataTypes.ENUM('open', 'pending', 'resolved', 'closed'),
      defaultValue: 'open'
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'created_at'
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updated_at'
    }
  }, {
    tableName: 'support_tickets',
    timestamps: true,
    underscored: true
  });

  SupportTicket.associate = (models) => {
    SupportTicket.belongsTo(models.Merchant, { foreignKey: 'merchantId', as: 'merchant' });
    SupportTicket.hasMany(models.TicketMessage, { foreignKey: 'ticketId', as: 'messages' });
  };

  return SupportTicket;
};
