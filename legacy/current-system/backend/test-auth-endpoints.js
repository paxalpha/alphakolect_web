const fetch = require('node-fetch');

async function testAuthenticatedEndpoints() {
  const BASE_URL = 'http://localhost:5000';
  
  console.log('Testing Authenticated Admin API Endpoints...\n');
  
  // Step 1: Login first to get token
  console.log('1. Logging in as super admin...');
  try {
    const loginRes = await fetch(`${BASE_URL}/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@alphaweb.com',
        password: 'Admin@123456'
      })
    });
    
    const loginData = await loginRes.json();
    console.log('   Login Status:', loginRes.status);
    
    if (!loginData.token) {
      console.error('   ❌ No token received!');
      console.log('   Response:', JSON.stringify(loginData, null, 2));
      process.exit(1);
    }
    
    console.log('   ✅ Login successful! Token received.');
    const token = loginData.token;
    console.log('   Token:', token.substring(0, 20) + '...\n');
    
    // Step 2: Test authenticated endpoints
    console.log('2. Testing /superadmin/superStats with token');
    const statsRes = await fetch(`${BASE_URL}/superadmin/superStats`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const statsData = await statsRes.json();
    console.log('   Status:', statsRes.status);
    console.log('   Response:', JSON.stringify(statsData, null, 2));
    console.log('');
    
    // Step 3: Test all merchants endpoint
    console.log('3. Testing /superadmin/allMerchants with token');
    const merchantsRes = await fetch(`${BASE_URL}/superadmin/allMerchants`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const merchantsData = await merchantsRes.json();
    console.log('   Status:', merchantsRes.status);
    console.log('   Merchants count:', merchantsData.count || 0);
    if (merchantsData.data && merchantsData.data.length > 0) {
      console.log('   First merchant:', merchantsData.data[0].businessName || merchantsData.data[0].name);
    }
    console.log('');
    
  } catch (err) {
    console.error('   Error:', err.message);
  }
  
  process.exit(0);
}

testAuthenticatedEndpoints();
