module.exports = (sequelize, DataTypes) => {
  const TicketMessage = sequelize.define('TicketMessage', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    ticketId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'ticket_id'
    },
    senderType: {
      type: DataTypes.ENUM('merchant', 'admin', 'system'),
      allowNull: false,
      field: 'sender_type'
    },
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'sender_id'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    hasAttachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'has_attachment'
    },
    attachmentUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'attachment_url'
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
    tableName: 'ticket_messages',
    timestamps: true,
    underscored: true
  });

  TicketMessage.associate = (models) => {
    TicketMessage.belongsTo(models.SupportTicket, { foreignKey: 'ticketId', as: 'ticket' });
  };

  return TicketMessage;
};
