const db = require('../models');

(async () => {
  try {
    await db.sequelize.authenticate();
    const [rows] = await db.sequelize.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'name'
    `);
    console.log(rows[0] || {});
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();


