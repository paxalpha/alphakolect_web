const db = require('../models');

(async () => {
  try {
    await db.sequelize.authenticate();
    const dbName = db.sequelize.getDatabaseName();
    console.log('Connected DB:', dbName);
    const [rows] = await db.sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'merchants'
      ORDER BY ordinal_position
    `);
    console.log('merchants columns:', rows.map(r => r.column_name));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();


