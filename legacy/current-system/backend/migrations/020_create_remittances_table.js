module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('remittances', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      collection_id: { type: Sequelize.INTEGER, allowNull: true },
      customer_id: { type: Sequelize.INTEGER, allowNull: false },
      customer_name: { type: Sequelize.STRING, allowNull: false },
      account_number: { type: Sequelize.STRING, allowNull: true },
      amount: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      agent_id: { type: Sequelize.INTEGER, allowNull: true },
      agent_name: { type: Sequelize.STRING, allowNull: true },
      merchant_id: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.ENUM('Pending', 'Approved', 'Rejected'), defaultValue: 'Pending' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('remittances');
  }
};


