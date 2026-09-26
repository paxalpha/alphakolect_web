const db = require('./models');
console.log('Keys in db:', Object.keys(db));
if (db.Plan && db.Merchant) {
  console.log('Plan is model:', db.Plan.prototype instanceof require('sequelize').Model);
  console.log('Merchant is model:', db.Merchant.prototype instanceof require('sequelize').Model);
}
process.exit(0);
