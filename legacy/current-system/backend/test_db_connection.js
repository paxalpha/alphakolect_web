const { Sequelize } = require('sequelize');

// Load env vars
require('dotenv').config();

const { createSequelize } = require('./config/database');

// Connection settings come only from the environment; TLS only when DB_SSL=true.
// (The target host is intentionally not printed.)
const sequelize = createSequelize(Sequelize, { logging: console.log });

sequelize.authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
        process.exit(1);
    });
