const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Creating branches table...');
      
      // Check if branches table already exists
      let tableExists = false;
      try {
        await queryInterface.describeTable('branches');
        tableExists = true;
      } catch (error) {
        // Table doesn't exist, which is what we want
        tableExists = false;
      }
      
      if (tableExists) {
        console.log('⚠️  Branches table already exists, skipping creation');
        return;
      }
      
      // Create branches table
      await queryInterface.createTable('branches', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        state: {
          type: DataTypes.STRING,
          allowNull: false
        },
        location: {
          type: DataTypes.STRING,
          allowNull: false
        },
        address: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        phone: {
          type: DataTypes.STRING,
          allowNull: true
        },
        email: {
          type: DataTypes.STRING,
          allowNull: true
        },
        merchant_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'merchants',
            key: 'id'
          }
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

      // Add indexes for better performance (with error handling)
      try {
        await queryInterface.addIndex('branches', ['merchant_id'], {
          name: 'branches_merchant_id'
        });
        console.log('✅ Added branches_merchant_id index');
      } catch (indexError) {
        if (String(indexError.message).includes('already exists')) {
          console.log('⚠️  Index branches_merchant_id already exists, skipping');
        } else {
          throw indexError;
        }
      }

      console.log('✅ Branches table created successfully');
    } catch (error) {
      console.error('❌ Error creating branches table:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Dropping branches table...');
      await queryInterface.dropTable('branches');
      console.log('✅ Branches table dropped successfully');
    } catch (error) {
      console.error('❌ Error dropping branches table:', error);
      throw error;
    }
  }
};
