const { Sequelize } = require('sequelize');

console.log('Testing LOCAL DB connection...');

const sequelize = new Sequelize('alphacollect_db', 'postgres', '', {
    host: 'localhost',
    port: 5432,
    dialect: 'postgres',
    logging: console.log
});

sequelize.authenticate()
    .then(() => {
        console.log('LOCAL DB Connection established successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('LOCAL DB Connection error:', err);
        process.exit(1);
    });
