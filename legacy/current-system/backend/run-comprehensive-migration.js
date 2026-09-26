const { Sequelize } = require('sequelize');
require('dotenv').config();
const { createSequelize } = require('./config/database');

async function runComprehensiveMigration() {
  const sequelize = createSequelize(Sequelize, { logging: console.log });
  
  try {
    console.log('🚀 Starting comprehensive database migration...');
    
    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    const queryInterface = sequelize.getQueryInterface();
    
    // Create branches table
    console.log('📦 Creating branches table...');
    await queryInterface.createTable('branches', {
      id: {
        type: Sequelize.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
      },
      state: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      },
      location: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      },
      merchantId: {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        }
      },
      createdAt: {
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.DataTypes.NOW
      },
      updatedAt: {
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.DataTypes.NOW
      }
    });

    // Create packages table
    console.log('📦 Creating packages table...');
    await queryInterface.createTable('packages', {
      id: {
        type: Sequelize.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
      },
      description: {
        type: Sequelize.DataTypes.TEXT,
        allowNull: true
      },
      merchantId: {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'merchants',
          key: 'id'
        }
      },
      createdAt: {
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.DataTypes.NOW
      },
      updatedAt: {
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.DataTypes.NOW
      }
    });

    // Add missing columns to agents table
    console.log('🔧 Adding missing columns to agents table...');
    try {
      await queryInterface.addColumn('agents', 'fullName', {
        type: Sequelize.DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Unknown'
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('fullName column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('agents', 'phoneNumber', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('phoneNumber column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('agents', 'branch', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('branch column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('agents', 'password', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('password column already exists or error:', error.message);
      }
    }

    // Add missing columns to customers table
    console.log('🔧 Adding missing columns to customers table...');
    try {
      await queryInterface.addColumn('customers', 'fullName', {
        type: Sequelize.DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Unknown'
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('fullName column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'phoneNumber', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('phoneNumber column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'accountNumber', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true,
        unique: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('accountNumber column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'alias', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('alias column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'address', {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('address column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'agentId', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'agents',
          key: 'id'
        }
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('agentId column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'branchId', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'branches',
          key: 'id'
        }
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('branchId column already exists or error:', error.message);
      }
    }

    try {
      await queryInterface.addColumn('customers', 'packageId', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'packages',
          key: 'id'
        }
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.log('packageId column already exists or error:', error.message);
      }
    }

    console.log('\n🎉 Comprehensive migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    process.exit(1);
  }
}

// Run migrations
runComprehensiveMigration();
