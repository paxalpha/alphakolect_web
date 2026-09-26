module.exports = (sequelize, DataTypes) => {
  const JournalEntry = sequelize.define('JournalEntry', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    totalDebit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    totalCredit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('draft', 'posted', 'reversed'),
      defaultValue: 'draft',
    },
    attachments: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    reversedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    merchantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
    tableName: 'journal_entries',
    timestamps: true,
  });

  JournalEntry.associate = (models) => {
    JournalEntry.belongsTo(models.Merchant, { foreignKey: 'merchantId' });
    JournalEntry.hasMany(models.JournalLine, { foreignKey: 'journalEntryId', as: 'lines' });
  };

  return JournalEntry;
};
