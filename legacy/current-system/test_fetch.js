const path = require('path');
const fs = require('fs');
const projectDir = "/home/mayowae/public_html/alphaweb";
const { Customer, Collection, Package } = require(path.join(projectDir, 'backend', 'models'));

async function testFetch() {
  try {
    const customers = await Customer.findAll({
      limit: 5,
      include: [
        {
          model: Package,
          as: 'Package',
          attributes: ['name']
        },
        {
          model: Collection,
          // as: 'Collections', // Try without alias first if not sure
          attributes: ['packageName', 'packageId'],
          limit: 1,
          order: [['dateCreated', 'DESC']],
          separate: true
        }
      ]
    });
    
    const results = customers.map(c => ({
      id: c.id,
      fullName: c.fullName,
      packageName: c.Package?.name,
      lastCollectionPackage: c.Collections?.[0]?.packageName
    }));
    
    fs.writeFileSync('/root/test_fetch_results.json', JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testFetch();
