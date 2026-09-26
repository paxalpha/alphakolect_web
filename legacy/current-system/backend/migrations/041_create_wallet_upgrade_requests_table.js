'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('wallet_upgrade_requests', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      merchantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      currentLevel: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      targetLevel: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected'),
        defaultValue: 'pending'
      },
      documents: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: '{}'
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: '{}'
      },
      rejectionReason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      reviewedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'admin_staff',
          key: 'id'
        }
      },
      reviewedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('now')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('now')
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('wallet_upgrade_requests');
  }
};
