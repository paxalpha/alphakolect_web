const db = require('./models');

async function checkPlans() {
  try {
    const [results] = await db.sequelize.query(
      'SELECT id, name, type, billing_cycle, pricing, currency, status FROM plans ORDER BY id'
    );
    
    console.log('📊 Plans in database:', results.length);
    
    if (results.length > 0) {
      console.log('\nPlans:');
      results.forEach(p => {
        console.log(`  ${p.id}. ${p.name} (${p.type}) - ${p.currency} ${p.pricing}/${p.billing_cycle} - ${p.status}`);
      });
    } else {
      console.log('⚠️  No plans found. Run: node seed-plans.js');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkPlans();
