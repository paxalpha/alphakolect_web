const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Creating basic tables for dashboard functionality...');
      
      // Create merchants table (basic)
      await queryInterface.createTable('merchants', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true
        },
        status: {
          type: DataTypes.ENUM('Active', 'Inactive'),
          defaultValue: 'Active'
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create agents table
      await queryInterface.createTable('agents', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false
        },
        phone: {
          type: DataTypes.STRING,
          allowNull: true
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Active', 'Inactive'),
          defaultValue: 'Active'
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create customers table
      await queryInterface.createTable('customers', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        email: {
          type: DataTypes.STRING,
          allowNull: true
        },
        phone: {
          type: DataTypes.STRING,
          allowNull: true
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Active', 'Inactive'),
          defaultValue: 'Active'
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create investments table
      await queryInterface.createTable('investments', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Active', 'Completed', 'Cancelled'),
          defaultValue: 'Active'
        },
        dateCreated: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create loans table
      await queryInterface.createTable('loans', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        loanAmount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        remainingAmount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Active', 'Completed', 'Defaulted'),
          defaultValue: 'Active'
        },
        dateIssued: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create repayments table
      await queryInterface.createTable('repayments', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
          defaultValue: 'Pending'
        },
        date: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Create wallet_transactions table
      await queryInterface.createTable('wallet_transactions', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        type: {
          type: DataTypes.ENUM('credit', 'debit'),
          allowNull: false
        },
        amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        status: {
          type: DataTypes.ENUM('Pending', 'Completed', 'Failed'),
          defaultValue: 'Pending'
        },
        createdAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        },
        updatedAt: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW
        }
      });

      // Insert a default merchant for testing
      await queryInterface.sequelize.query(`
        INSERT INTO merchants (id, name, email, status, "createdAt", "updatedAt") 
        VALUES (2, 'Test Merchant', 'test@merchant.com', 'Active', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      console.log('Successfully created basic tables');
    } catch (error) {
      console.error('Error creating basic tables:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Dropping basic tables...');
      await queryInterface.dropTable('wallet_transactions');
      await queryInterface.dropTable('repayments');
      await queryInterface.dropTable('loans');
      await queryInterface.dropTable('investments');
      await queryInterface.dropTable('customers');
      await queryInterface.dropTable('agents');
      await queryInterface.dropTable('merchants');
      console.log('Successfully dropped basic tables');
    } catch (error) {
      console.error('Error dropping basic tables:', error);
      throw error;
    }
  }
};
