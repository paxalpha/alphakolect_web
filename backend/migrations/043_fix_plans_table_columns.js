'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('plans');

    if (!tableInfo.currency) {
      await queryInterface.addColumn('plans', 'currency', {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'NGN'
      });
    }

    if (!tableInfo.status) {
      // Need to create enum if it doesn't exist
      try {
        await queryInterface.addColumn('plans', 'status', {
          type: Sequelize.ENUM('active', 'inactive'),
          allowNull: false,
          defaultValue: 'active'
        });
      } catch (e) {
        // Fallback to STRING if enum creation fails or already exists
        await queryInterface.addColumn('plans', 'status', {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: 'active'
        });
      }
    }

    if (!tableInfo.features) {
      await queryInterface.addColumn('plans', 'features', {
        type: Sequelize.JSON,
        allowNull: true
      });
    }

    if (!tableInfo.description) {
      await queryInterface.addColumn('plans', 'description', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }

    if (!tableInfo.max_agents && !tableInfo.maxAgents) {
      await queryInterface.addColumn('plans', 'max_agents', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }

    if (!tableInfo.max_customers && !tableInfo.maxCustomers) {
      await queryInterface.addColumn('plans', 'max_customers', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }

    if (!tableInfo.max_transactions && !tableInfo.maxTransactions) {
      await queryInterface.addColumn('plans', 'max_transactions', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }

    // Ensure merchant_id is nullable for global plans
    if (tableInfo.merchant_id && !tableInfo.merchant_id.allowNull) {
      await queryInterface.changeColumn('plans', 'merchant_id', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('plans', 'currency');
    await queryInterface.removeColumn('plans', 'status');
    await queryInterface.removeColumn('plans', 'features');
    await queryInterface.removeColumn('plans', 'description');
    await queryInterface.removeColumn('plans', 'max_agents');
    await queryInterface.removeColumn('plans', 'max_customers');
    await queryInterface.removeColumn('plans', 'max_transactions');
  }
};
