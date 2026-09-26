const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function migrate() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('merchants');

    if (!tableInfo.accountNumber) {
      console.log('Adding accountNumber to merchants...');
      await queryInterface.addColumn('merchants', 'accountNumber', {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    if (!tableInfo.bankName) {
      console.log('Adding bankName to merchants...');
      await queryInterface.addColumn('merchants', 'bankName', {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    if (!tableInfo.accountName) {
      console.log('Adding accountName to merchants...');
      await queryInterface.addColumn('merchants', 'accountName', {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    if (!tableInfo.bankCode) {
      console.log('Adding bankCode to merchants...');
      await queryInterface.addColumn('merchants', 'bankCode', {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sequelize.close();
  }
}

migrate();
