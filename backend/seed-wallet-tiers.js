const { WalletTier } = require('./models');

const seedTiers = async () => {
  const tiers = [
    {
      level: 0,
      name: 'Starter',
      dailyLimit: 'NO',
      maxBalance: 'NO',
      fee: 'NO',
      requirements: ['Register'],
    },
    {
      level: 1,
      name: 'Basic verification',
      dailyLimit: '₦50,000',
      maxBalance: '₦100,000',
      fee: '₦20,000',
      requirements: ['Name', 'Phone number', 'Email'],
    },
    {
      level: 2,
      name: 'KYC verification',
      dailyLimit: '₦500,000',
      maxBalance: '₦2,000,000',
      fee: '₦20,000',
      requirements: ['Government ID', 'Selfie/face match', 'Date of birth'],
    },
    {
      level: 3,
      name: 'Business/Merchant',
      dailyLimit: '₦2,500,000',
      maxBalance: '₦4,000,000',
      fee: '₦20,000',
      requirements: ['Business registration', 'Director details', 'Proof of address', 'Bank account verification'],
    },
  ];

  for (const tier of tiers) {
    const [t, created] = await WalletTier.findOrCreate({
      where: { level: tier.level },
      defaults: tier,
    });
    if (created) {
      console.log(`Created Tier ${tier.level}`);
    } else {
      await t.update(tier);
      console.log(`Updated Tier ${tier.level}`);
    }
  }
  console.log('Wallet tiers seeded successfully');
  process.exit(0);
};

seedTiers().catch(err => {
  console.error(err);
  process.exit(1);
});
