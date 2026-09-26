const fetch = require('node-fetch');

async function testAdminEndpoints() {
  const BASE_URL = 'http://localhost:5000';
  
  console.log('Testing Admin API Endpoints...\n');
  
  // Test 1: Super Admin Stats
  try {
    console.log('1. Testing /superadmin/superStats');
    const statsRes = await fetch(`${BASE_URL}/superadmin/superStats`);
    const statsData = await statsRes.json();
    console.log('   Status:', statsRes.status);
    console.log('   Response:', JSON.stringify(statsData, null, 2));
    console.log('');
  } catch (err) {
    console.error('   Error:', err.message);
    console.log('');
  }
  
  // Test 2: All Activities
  try {
    console.log('2. Testing /superadmin/allActivities');
    const activitiesRes = await fetch(`${BASE_URL}/superadmin/allActivities`);
    const activitiesData = await activitiesRes.json();
    console.log('   Status:', activitiesRes.status);
    console.log('   Response:', JSON.stringify(activitiesData, null, 2));
    console.log('');
  } catch (err) {
    console.error('   Error:', err.message);
    console.log('');
  }
  
  // Test 3: All Merchants
  try {
    console.log('3. Testing /superadmin/allMerchants');
    const merchantsRes = await fetch(`${BASE_URL}/superadmin/allMerchants`);
    const merchantsData = await merchantsRes.json();
    console.log('   Status:', merchantsRes.status);
    console.log('   Response:', JSON.stringify(merchantsData, null, 2));
    console.log('');
  } catch (err) {
    console.error('   Error:', err.message);
    console.log('');
  }
  
  process.exit(0);
}

testAdminEndpoints();
