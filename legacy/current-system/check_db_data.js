const path = require('path');
const projectDir = "/home/mayowae/public_html/alphaweb";
const { Customer, Package, Collection } = require(path.join(projectDir, 'backend', 'models'));

async function checkData() {
  try {
    const packages = await Package.findAll({ limit: 10 });
    console.log('\nPackages in DB:');
    packages.forEach(p => console.log(`ID: ${p.id}, Name: ${p.name}`));

    const customers = await Customer.findAll({
      include: [{ model: Package, as: 'Package' }],
      limit: 10
    });
    
    console.log('\nCustomer Data with Packages:');
    customers.forEach(c => {
      console.log(`ID: ${c.id}, Name: ${c.fullName}, packageId: ${c.packageId}, PackageName: ${c.Package ? c.Package.name : 'NULL'}`);
    });

    const collections = await Collection.findAll({
      limit: 10
    });
    console.log('\nCollections in DB:');
    collections.forEach(col => {
      console.log(`ID: ${col.id}, customerId: ${col.customerId}, packageId: ${col.packageId}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error during database check:');
    console.error(err);
    process.exit(1);
  }
}

checkData();
