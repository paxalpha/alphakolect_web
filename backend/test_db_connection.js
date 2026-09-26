const { Sequelize } = require('sequelize');

// Load env vars
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('DATABASE_URL not found in .env');
    process.exit(1);
}

console.log('Testing connection to:', databaseUrl.split('@')[1]);

const sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: console.log,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

sequelize.authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
        process.exit(1);
    });
