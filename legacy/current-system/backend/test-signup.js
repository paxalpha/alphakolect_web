const fetch = require('node-fetch');

async function testSignup() {
  try {
    const response = await fetch('http://localhost:3000/merchant/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessName: 'Test Business 2',
        businessAlias: 'TestAlias2',
        phone: '1234567891',
        email: 'test2@example.com',
        currency: 'N (NGN)',
        password: 'password123',
      }),
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', data);
  } catch (error) {
    console.error('Error:', error);
  }
}

testSignup();
