const path = require('path');
const fs = require('fs');
const projectDir = "/home/mayowae/public_html/alphaweb";
const { sequelize } = require(path.join(projectDir, 'backend', 'models'));

async function check() {
  try {
    const [results] = await sequelize.query(
      "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'package_id'"
    );
    const exists = results[0].count > 0;
    fs.writeFileSync('/root/package_id_exists.txt', exists ? 'YES' : 'NO');
    
    const [data] = await sequelize.query("SELECT id, full_name, package_id FROM customers LIMIT 5");
    fs.writeFileSync('/root/customer_samples.txt', JSON.stringify(data, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
