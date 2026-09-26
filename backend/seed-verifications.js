const { Merchant, WalletUpgradeRequest, db } = require('./models');
const bcrypt = require('bcryptjs');

async function seedData() {
  try {
    console.log('Starting seed process...');

    // 1. Ensure we have some merchants
    const merchantData = [
      {
        name: 'Riddus Microfinance',
        businessName: 'Riddus Microfinance LTD',
        businessAlias: 'Riddus',
        email: 'riddus@microfinance.com',
        phone: '08012345678',
        password: await bcrypt.hash('password123', 10),
        currency: 'NGN',
        accountLevel: 'Tier 0',
        isVerified: true
      },
      {
        name: 'Alpha Logistics',
        businessName: 'Alpha Logistics',
        businessAlias: 'AlphaLog',
        email: 'logistics@alpha.com',
        phone: '08099988877',
        password: await bcrypt.hash('password123', 10),
        currency: 'NGN',
        accountLevel: 'Tier 1',
        isVerified: true
      },
      {
        name: 'Global Ventures',
        businessName: 'Global Ventures',
        businessAlias: 'GlobalV',
        email: 'global@ventures.com',
        phone: '07011223344',
        password: await bcrypt.hash('password123', 10),
        currency: 'NGN',
        accountLevel: 'Tier 2',
        isVerified: true
      }
    ];

    const createdMerchants = [];
    for (const m of merchantData) {
      const [merchant] = await Merchant.findOrCreate({
        where: { email: m.email },
        defaults: m
      });
      createdMerchants.push(merchant);
      console.log(`Merchant ${merchant.businessName} ready.`);
    }

    // Clear existing test requests
    await WalletUpgradeRequest.destroy({
      where: {
        merchantId: createdMerchants.map(m => m.id)
      }
    });

    // 2. Create some WalletUpgradeRequests
    const requests = [
      {
        merchantId: createdMerchants[0].id,
        currentLevel: 0,
        targetLevel: 1,
        status: 'rejected',
        rejectionReason: 'Document not clear',
        metadata: { fullName: 'John Doe', idType: 'National ID', dob: '1985-05-15' },
        documents: { governmentId: 'id-1.jpg' },
        createdAt: new Date(Date.now() - 86400000 * 5)
      },
      {
        merchantId: createdMerchants[0].id,
        currentLevel: 0,
        targetLevel: 1,
        status: 'rejected',
        rejectionReason: 'Blurry image',
        metadata: { fullName: 'John Doe', idType: 'National ID', dob: '1985-05-15' },
        documents: { governmentId: 'id-2.jpg' },
        createdAt: new Date(Date.now() - 86400000 * 2)
      },
      {
        merchantId: createdMerchants[0].id,
        currentLevel: 0,
        targetLevel: 1,
        status: 'pending',
        metadata: { fullName: 'John Doe', idType: 'National ID', dob: '1985-05-15' },
        documents: { governmentId: 'id-3.jpg', selfie: 'selfie.jpg' },
        createdAt: new Date()
      },
      {
        merchantId: createdMerchants[1].id,
        currentLevel: 1,
        targetLevel: 2,
        status: 'pending',
        metadata: { fullName: 'Sarah Smith', idType: 'Voters Card', dob: '1990-10-20' },
        documents: { governmentId: 'id-voters.jpg', proofOfAddress: 'utility.pdf' },
        createdAt: new Date(Date.now() - 3600000 * 4)
      },
      {
        merchantId: createdMerchants[2].id,
        currentLevel: 2,
        targetLevel: 3,
        status: 'approved',
        metadata: { fullName: 'Mike Global', idType: 'Passport', rcNumber: 'RC1234567', directorName: 'James Bond' },
        documents: { businessCert: 'cac-cert.jpg', directorId: 'passport.jpg' },
        createdAt: new Date(Date.now() - 86400000 * 10)
      }
    ];

    for (const r of requests) {
      await WalletUpgradeRequest.create(r);
    }

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seedData();
