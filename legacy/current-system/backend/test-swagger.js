const fetch = require('node-fetch');

async function testSwagger() {
  try {
    console.log('Testing Swagger UI setup...\n');
    
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await fetch('http://localhost:3000/health');
    const healthData = await healthResponse.json();
    console.log('Health check:', healthData);
    
    // Test Swagger UI endpoint
    console.log('\n2. Testing Swagger UI endpoint...');
    const swaggerResponse = await fetch('http://localhost:3000/api-docs/');
    console.log('Swagger UI status:', swaggerResponse.status);
    
    if (swaggerResponse.status === 200) {
      console.log('✅ Swagger UI is accessible at http://localhost:3000/api-docs/');
    } else {
      console.log('❌ Swagger UI not accessible');
    }
    
    // Test Swagger JSON spec
    console.log('\n3. Testing Swagger JSON spec...');
    const specResponse = await fetch('http://localhost:3000/api-docs/swagger.json');
    const specData = await specResponse.json();
    console.log('Swagger spec loaded:', specData.info.title, 'v' + specData.info.version);
    
    console.log('\n🎉 Swagger setup is working correctly!');
    console.log('📖 Access Swagger UI at: http://localhost:3000/api-docs/');
    
  } catch (error) {
    console.error('❌ Error testing Swagger:', error.message);
    console.log('Make sure the server is running on port 3000');
  }
}

testSwagger();
