const { submitUpgradeRequest } = require('./controllers/verificationController');
const { Merchant, WalletTransaction, WalletTier, WalletUpgradeRequest } = require('./models');

async function test() {
  try {
    console.log('--- Testing Auto Fee Deduction ---');

    // 1. Create/Find a test merchant
    const [merchant] = await Merchant.findOrCreate({
      where: { email: 'fee-test@example.com' },
      defaults: {
        businessName: 'Fee Test Merchant',
        businessAlias: 'fee-test',
        phone: '1234567890',
        password: 'password',
        currency: 'NGN',
        accountLevel: 'Tier 1',
        status: 'Active'
      }
    });
    console.log('Merchant ID:', merchant.id);

    // 2. Ensure Tier 2 exists with a fee
    const [tier2] = await WalletTier.findOrCreate({
      where: { level: 2 },
      defaults: {
        name: 'KYC verification',
        fee: '₦20,000',
        requirements: ['Government ID', 'Selfie']
      }
    });

    // 3. Clear existing transactions for this merchant to have a clean slate
    await WalletTransaction.destroy({ where: { merchantId: merchant.id } });

    // 4. Give them exactly 50,000 balance
    await WalletTransaction.create({
      merchantId: merchant.id,
      type: 'credit',
      transactionType: 'initial_balance',
      amount: 50000,
      status: 'Completed',
      description: 'Test Initial Balance'
    });
    console.log('Balance set to 50,000');

    // 5. Mock Request/Response
    const req = {
      user: { id: merchant.id },
      body: {
        targetLevel: 2,
        metadata: JSON.stringify({ dob: '1990-01-01' })
      },
      files: {
        selfie: [{ filename: 'test-selfie.jpg' }],
        governmentId: [{ filename: 'test-id.jpg' }]
      }
    };

    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      }
    };

    // 6. Run deduction logic (via submitUpgradeRequest)
    await submitUpgradeRequest(req, res);

    console.log('Response Message:', res.data.message);
    console.log('Fee Deducted Flag:', res.data.feeDeducted);

    // 7. Verify in DB
    const feeTx = await WalletTransaction.findOne({
      where: {
        merchantId: merchant.id,
        category: 'Service Fee'
      }
    });

    if (feeTx) {
      console.log('✅ SUCCESS: Fee transaction found!');
      console.log('Amount:', feeTx.amount);
      console.log('Description:', feeTx.description);
      console.log('Balance After:', feeTx.balanceAfter);
    } else {
      console.log('❌ FAILURE: No fee transaction found');
    }

    const upgradeReq = await WalletUpgradeRequest.findOne({
      where: { merchantId: merchant.id, targetLevel: 2 }
    });
    
    if (upgradeReq && upgradeReq.metadata.feeDeducted) {
       console.log('✅ SUCCESS: Upgrade request metadata updated!');
    } else {
       console.log('❌ FAILURE: Upgrade request metadata missing fee info');
    }

  } catch (e) {
    console.error('Test error:', e);
  } finally {
    process.exit(0);
  }
}

test();
