module.exports = (sequelize, DataTypes) => {
  const JournalLine = sequelize.define('JournalLine', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    journalEntryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    debit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    credit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    description: {
      type: DataTypes.TEXT,
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
    tableName: 'journal_lines',
    timestamps: true,
  });

  JournalLine.associate = (models) => {
    JournalLine.belongsTo(models.JournalEntry, { foreignKey: 'journalEntryId' });
    JournalLine.belongsTo(models.Account, { foreignKey: 'accountId' });
  };

  return JournalLine;
};
