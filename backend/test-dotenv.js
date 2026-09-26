try {
  const dotenv = require('dotenv');
  console.log('dotenv module found successfully');
  console.log('dotenv version:', dotenv.version || 'unknown');
} catch (error) {
  console.error('Error loading dotenv:', error.message);
}
