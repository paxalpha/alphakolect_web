const { Sequelize } = require('sequelize');

module.exports = {
  up: async (queryInterface) => {
    // Check if table exists first
    const tables = await queryInterface.showAllTables();
    if (tables.includes('plans')) {
      console.log('Plans table already exists, skipping creation');
      return;
    }

    await queryInterface.createTable('plans', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      type: {
        type: Sequelize.ENUM('standard', 'custom'),
        allowNull: false,
        defaultValue: 'standard',
      },
      billingCycle: {
        type: Sequelize.ENUM('monthly', 'yearly'),
        allowNull: false,
        defaultValue: 'monthly',
        field: 'billing_cycle'
      },
      pricing: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN',
      },
      features: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      maxAgents: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'max_agents'
      },
      maxCustomers: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'max_customers'
      },
      maxTransactions: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'max_transactions'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'merchants',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    console.log('Plans table created successfully');
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('plans');
    console.log('Plans table dropped successfully');
  },
};
