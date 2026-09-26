'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create super_admins table
    await queryInterface.createTable('super_admins', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      password: {
        type: Sequelize.STRING,
        allowNull: false
      },
      role: {
        type: Sequelize.ENUM('superadmin', 'admin'),
        allowNull: false,
        defaultValue: 'superadmin'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create activities table
    await queryInterface.createTable('activities', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'merchantId'
      },
      agentId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'agentId'
      },
      staffId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        field: 'staffId'
      },
      person: {
        type: Sequelize.ENUM('merchant', 'agent', 'staff'),
        allowNull: false
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false
      },
      details: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      date: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'createdAt'
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'updatedAt'
      }
    });

    // Create plans table
    await queryInterface.createTable('plans', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      billing_cycle: {
        type: Sequelize.ENUM('monthly', 'yearly'),
        allowNull: false
      },
      pricing: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      merchant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      no_of_branches: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      no_of_customers: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      no_of_agents: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes for better performance
    await queryInterface.addIndex('super_admins', ['email']);
    await queryInterface.addIndex('activities', ['merchantId']);
    await queryInterface.addIndex('activities', ['agentId']);
    await queryInterface.addIndex('activities', ['staffId']);
    await queryInterface.addIndex('activities', ['date']);
    await queryInterface.addIndex('plans', ['merchant_id']);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop tables in reverse order
    await queryInterface.dropTable('plans');
    await queryInterface.dropTable('activities');
    await queryInterface.dropTable('super_admins');
  }
};
