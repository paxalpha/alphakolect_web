'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('📦 Creating transactions table...');
      await queryInterface.createTable('transactions', {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true
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
        amount: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false
        },
        currency: {
          type: Sequelize.STRING(3),
          allowNull: false,
          defaultValue: 'NGN'
        },
        type: {
          type: Sequelize.ENUM('deposit', 'withdrawal', 'transfer', 'payment', 'refund'),
          allowNull: false
        },
        status: {
          type: Sequelize.ENUM('pending', 'completed', 'failed', 'cancelled'),
          defaultValue: 'pending'
        },
        reference: {
          type: Sequelize.STRING,
          allowNull: true,
          unique: true
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        metadata: {
          type: Sequelize.JSONB,
          allowNull: true,
          defaultValue: {}
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
      console.log('✅ transactions table created successfully');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⚠️ transactions table already exists, skipping creation');
      } else {
        throw error;
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('transactions');
  }
};
