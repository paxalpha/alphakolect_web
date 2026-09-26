const { QueryInterface, DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add OTP fields to merchants table
    await queryInterface.addColumn('merchants', 'otp', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('merchants', 'otpExpires', {
      type: DataTypes.DATE,
      allowNull: true,
    });

    // Add OTP fields to collaborators table
    await queryInterface.addColumn('collaborators', 'otp', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('collaborators', 'otpExpires', {
      type: DataTypes.DATE,
      allowNull: true,
    });

    console.log('OTP fields added to merchants and collaborators tables');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove OTP fields from merchants table
    await queryInterface.removeColumn('merchants', 'otp');
    await queryInterface.removeColumn('merchants', 'otpExpires');

    // Remove OTP fields from collaborators table
    await queryInterface.removeColumn('collaborators', 'otp');
    await queryInterface.removeColumn('collaborators', 'otpExpires');

    console.log('OTP fields removed from merchants and collaborators tables');
  }
};
