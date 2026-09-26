const { sequelize, Merchant, Agent, Customer } = require('./models');

async function checkMerchantData() {
  try {
    console.log('=== Checking Merchant Data ===\n');
    
    // Get all merchants
    const merchants = await Merchant.findAll({
      attributes: ['id', 'businessName', 'name'],
    });
    
    console.log('Merchants in database:');
    merchants.forEach(m => {
      console.log(`  ID: ${m.id}, Name: ${m.businessName || m.name}`);
    });
    console.log('');
    
    // Get all agents with their merchantId
    const agents = await Agent.findAll({
      attributes: ['id', 'fullName', 'merchantId'],
    });
    
    console.log('Agents in database:');
    agents.forEach(a => {
      console.log(`  ID: ${a.id}, Name: ${a.fullName}, MerchantID: ${a.merchantId}`);
    });
    console.log('');
    
    // Get all customers with their merchantId
    const customers = await Customer.findAll({
      attributes: ['id', 'fullName', 'merchantId'],
    });
    
    console.log('Customers in database:');
    customers.forEach(c => {
      console.log(`  ID: ${c.id}, Name: ${c.fullName}, MerchantID: ${c.merchantId}`);
    });
    console.log('');
    
    // Try to fetch merchants with associations
    console.log('Testing associations...');
    const merchantsWithAssoc = await Merchant.findAll({
      include: [
        {
          model: Agent,
          as: 'agents',
          attributes: ['id', 'fullName'],
        },
        {
          model: Customer,
          as: 'customers',
          attributes: ['id', 'fullName'],
        },
      ],
    });
    
    console.log('\nMerchants with associations:');
    merchantsWithAssoc.forEach(m => {
      const data = m.toJSON();
      console.log(`  Merchant: ${data.businessName || data.name} (ID: ${data.id})`);
      console.log(`    Agents: ${data.agents ? data.agents.length : 0}`);
      console.log(`    Customers: ${data.customers ? data.customers.length : 0}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

checkMerchantData();
