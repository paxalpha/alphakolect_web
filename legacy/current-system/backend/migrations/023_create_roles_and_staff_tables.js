const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Creating roles and staff tables...');
      const qi = queryInterface;

      // Helpers
      const tableExists = async (tableName) => {
        const result = await qi.sequelize.query(
          `SELECT to_regclass('public.${tableName}') AS exists;`
        );
        return result && result[0] && result[0][0] && result[0][0].exists !== null;
      };

      const indexExists = async (tableName, indexName) => {
        try {
          const indexes = await qi.showIndex(tableName);
          return indexes.some((idx) => idx.name === indexName);
        } catch (e) {
          return false;
        }
      };
      
      // Create roles table (if not exists)
      if (!(await tableExists('roles'))) {
        await queryInterface.createTable('roles', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        roleName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        cantView: {
          type: DataTypes.INTEGER,
          defaultValue: 0
        },
        canViewOnly: {
          type: DataTypes.INTEGER,
          defaultValue: 0
        },
        canEdit: {
          type: DataTypes.INTEGER,
          defaultValue: 0
        },
        permissions: {
          type: DataTypes.JSON,
          allowNull: false
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
      }

      // Create staff table (if not exists)
      if (!(await tableExists('staff'))) {
        await queryInterface.createTable('staff', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        fullName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true
        },
        phoneNumber: {
          type: DataTypes.STRING,
          allowNull: false
        },
        branch: {
          type: DataTypes.STRING,
          allowNull: false
        },
        role: {
          type: DataTypes.STRING,
          allowNull: false
        },
        status: {
          type: DataTypes.STRING,
          defaultValue: 'active'
        },
        merchantId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
        },
        roleId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'roles',
            key: 'id'
          }
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
      }

      // Add indexes for better performance (if not exists)
      const merchantIdxName = 'staff_merchant_id';
      const roleIdxName = 'staff_role_id';
      const emailIdxName = 'staff_email';

      if (!(await indexExists('staff', merchantIdxName))) {
        await queryInterface.addIndex('staff', ['merchantId'], { name: merchantIdxName });
      }
      if (!(await indexExists('staff', roleIdxName))) {
        await queryInterface.addIndex('staff', ['roleId'], { name: roleIdxName });
      }
      if (!(await indexExists('staff', emailIdxName))) {
        await queryInterface.addIndex('staff', ['email'], { name: emailIdxName });
      }

      console.log('Successfully created roles and staff tables');
    } catch (error) {
      console.error('Error creating roles and staff tables:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Dropping roles and staff tables...');
      await queryInterface.dropTable('staff');
      await queryInterface.dropTable('roles');
      console.log('Successfully dropped roles and staff tables');
    } catch (error) {
      console.error('Error dropping roles and staff tables:', error);
      throw error;
    }
  }
};
