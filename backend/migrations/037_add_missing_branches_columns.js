const { Sequelize, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Adding missing columns to branches table...');
      
      // Check if branches table exists
      const tableExists = await queryInterface.describeTable('branches');
      
      if (tableExists) {
        // Add state column if it doesn't exist
        if (!tableExists.state) {
          await queryInterface.addColumn('branches', 'state', {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Unknown'
          });
          console.log('✅ Added state column to branches table');
        }
        
        // Add location column if it doesn't exist
        if (!tableExists.location) {
          await queryInterface.addColumn('branches', 'location', {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Unknown'
          });
          console.log('✅ Added location column to branches table');
        }
        
        console.log('✅ Branches table columns updated successfully');
      } else {
        console.log('⚠️  Branches table does not exist, skipping column addition');
      }
    } catch (error) {
      console.error('❌ Error updating branches table:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Removing columns from branches table...');
      
      // Check if columns exist before removing
      const tableExists = await queryInterface.describeTable('branches');
      
      if (tableExists) {
        if (tableExists.state) {
          await queryInterface.removeColumn('branches', 'state');
        }
        if (tableExists.location) {
          await queryInterface.removeColumn('branches', 'location');
        }
      }
      
      console.log('✅ Branches table columns removed successfully');
    } catch (error) {
      console.error('❌ Error removing columns from branches table:', error);
      throw error;
    }
  }
};

