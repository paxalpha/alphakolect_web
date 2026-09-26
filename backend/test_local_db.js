const { Sequelize } = require('sequelize');

console.log('Testing LOCAL DB connection...');

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createSequelize } = require('./config/database');

// Connection settings come only from the environment (see .env.example)
const sequelize = createSequelize(Sequelize, { logging: console.log });

sequelize.authenticate()
    .then(() => {
        console.log('LOCAL DB Connection established successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('LOCAL DB Connection error:', err);
        process.exit(1);
    });
