const { Sequelize } = require('sequelize');

module.exports = {
  up: async (queryInterface, DataTypes) => {
    // Create charges table
    await queryInterface.createTable('charges', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      charge_name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      type: {
        type: DataTypes.ENUM('Loan', 'Penalty', 'Service'),
        allowNull: false
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
      },
      merchant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });

    // Create charge_assignments table
    await queryInterface.createTable('charge_assignments', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      charge_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'charges',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      customer_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'customers',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
      },
      due_date: {
        type: DataTypes.DATE,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM('Pending', 'Paid', 'Overdue'),
        defaultValue: 'Pending'
      },
      merchant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      date_applied: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      date_paid: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });

    // Add indexes for better performance
    await queryInterface.addIndex('charges', ['merchant_id']);
    await queryInterface.addIndex('charges', ['is_active']);
    await queryInterface.addIndex('charge_assignments', ['merchant_id']);
    await queryInterface.addIndex('charge_assignments', ['charge_id']);
    await queryInterface.addIndex('charge_assignments', ['customer_id']);
    await queryInterface.addIndex('charge_assignments', ['status']);
    await queryInterface.addIndex('charge_assignments', ['due_date']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('charge_assignments');
    await queryInterface.dropTable('charges');
  }
};
