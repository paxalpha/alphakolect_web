const { WalletUpgradeRequest, Merchant, AdminStaff, WalletTier, WalletTransaction } = require('../models');

// Submit upgrade request (Merchant)
const submitUpgradeRequest = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { targetLevel, metadata: metadataRaw } = req.body;
    
    const targetLvl = parseInt(targetLevel);
    
    // Check if there's already a pending request
    const existingRequest = await WalletUpgradeRequest.findOne({
      where: { merchantId, status: 'pending' }
    });
    
    if (existingRequest) {
      return res.status(400).json({ message: 'You already have a pending upgrade request' });
    }
    
    // Get merchant current level
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found' });
    }
    
    const currentLevelStr = merchant.accountLevel || 'Tier 0';
    const currentLevel = parseInt(currentLevelStr.replace(/[^0-9]/g, '')) || 0;

    if (targetLvl <= currentLevel) {
      return res.status(400).json({ message: `You are already at or above Tier ${targetLvl}` });
    }

    // Validate Required Documents based on Tier
    const documents = {};
    if (req.files) {
      Object.keys(req.files).forEach(key => {
         documents[key] = req.files[key][0].filename;
      });
    }

    let metadata = {};
    try {
      metadata = typeof metadataRaw === 'string' ? JSON.parse(metadataRaw) : (metadataRaw || {});
    } catch (e) {
      metadata = { note: metadataRaw };
    }

    // Tier 2 Requirements: Selfie and Government ID and DOB
    if (targetLvl === 2) {
      if (!documents.selfie) {
        return res.status(400).json({ message: 'Selfie is required for Tier 2 upgrade' });
      }
      if (!documents.governmentId) {
        return res.status(400).json({ message: 'Government ID is required for Tier 2 upgrade' });
      }
      if (!metadata.dob) {
        return res.status(400).json({ message: 'Date of Birth is required for Tier 2 upgrade' });
      }
    }

    // Tier 3 Requirements: Business Cert and Proof of Address
    if (targetLvl === 3) {
      if (!documents.businessCert) {
        return res.status(400).json({ message: 'Business Certificate is required for Tier 3 upgrade' });
      }
      if (!documents.proofOfAddress) {
        return res.status(400).json({ message: 'Proof of Address is required for Tier 3 upgrade' });
      }
    }
    
    // Get Target Tier to find the fee
    const targetTier = await WalletTier.findOne({ where: { level: targetLvl } });
    if (!targetTier) {
       return res.status(404).json({ message: 'Target tier not found' });
    }

    const parseAmount = (str) => {
      if (!str) return 0;
      return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    };

    const upgradeFee = parseAmount(targetTier.fee);

    // Calculate current balance
    const { getWalletBalance: fetchTpBalance } = require('../utils/transactPay');
    let currentBalance = 0;

    // Check TransactPay if available
    if (merchant.accountNumber) {
      try {
        const tpBalanceData = await fetchTpBalance(merchant.accountNumber);
        if (tpBalanceData) {
          currentBalance = parseFloat(tpBalanceData.availableBalance || tpBalanceData.balance || 0);
        }
      } catch (tpError) {
        console.warn('Failed to fetch TransactPay balance, falling back to local calculation');
      }
    }

    // Fallback or Addition: local transaction calculation if currentBalance is still 0 
    // (or just always use local for deduplication if that's the source of truth for fees)
    if (currentBalance === 0) {
      const transactions = await WalletTransaction.findAll({
        where: { merchantId, status: 'Completed' }
      });
      
      transactions.forEach(tx => {
        const amt = parseFloat(tx.amount);
        if (tx.transactionType === 'credit' || tx.type === 'credit' || tx.transactionType === 'initial_balance') {
          currentBalance += amt;
        } else if (tx.transactionType === 'debit' || tx.type === 'debit') {
          currentBalance -= amt;
        }
      });
    }

    let feeDeducted = false;

    // Deduct fee if balance is sufficient
    if (upgradeFee > 0 && currentBalance >= upgradeFee) {
      try {
        await WalletTransaction.create({
          merchantId,
          type: 'debit',
          transactionType: 'debit',
          amount: upgradeFee,
          status: 'Completed',
          description: `Wallet Tier ${targetLvl} (${targetTier.name}) Upgrade Fee`,
          reference: `FEE-UPG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          category: 'Service Fee',
          date: new Date(),
          balanceBefore: currentBalance,
          balanceAfter: currentBalance - upgradeFee
        });
        feeDeducted = true;
        metadata.upgradeFee = upgradeFee;
        metadata.feeDeducted = true;
        metadata.deductedAt = new Date().toISOString();

        // Book transaction fee double entry
        try {
          const { postJournalForTransaction } = require('../utils/transactionMapping');
          await postJournalForTransaction(
            'TRANSACTION_FEE',
            upgradeFee,
            merchantId,
            `Upgrade to Tier ${targetLvl} (${targetTier.name}) Fee`
          );
        } catch (deErr) {
          console.warn('⚠️ Double-entry skipped for upgrade fee:', deErr.message);
        }
      } catch (deductionError) {
        console.error('Failed to deduct upgrade fee:', deductionError);
        // We continue with the request but mention the failure
      }
    }
    
    // Create request
    const upgradeRequest = await WalletUpgradeRequest.create({
      merchantId,
      currentLevel,
      targetLevel: targetLvl,
      metadata,
      documents,
    });
    
    res.status(201).json({
      message: feeDeducted 
        ? `Upgrade request submitted successfully. A fee of ${targetTier.fee} has been deducted from your wallet.`
        : 'Upgrade request submitted successfully. Our team will review your selfie and documents.',
      upgradeRequest,
      feeDeducted
    });
  } catch (error) {
    console.error('Submit upgrade request error:', error);
    res.status(500).json({ message: 'Failed to submit upgrade request', error: error.message });
  }
};

// List all upgrade requests (Admin)
const listUpgradeRequests = async (req, res) => {
  try {
    const requests = await WalletUpgradeRequest.findAll({
      include: [
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName', 'email', 'phone', 'accountLevel']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      message: 'Upgrade requests retrieved successfully',
      requests
    });
  } catch (error) {
    console.error('List upgrade requests error:', error);
    res.status(500).json({ message: 'Failed to retrieve upgrade requests', error: error.message });
  }
};

// Update request status (Admin)
const updateRequestStatus = async (req, res) => {
  try {
    const { id, status, rejectionReason } = req.body;
    const adminId = req.user.id;
    
    const request = await WalletUpgradeRequest.findByPk(id);
    if (!request) {
      return res.status(404).json({ message: 'Upgrade request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'This request has already been processed' });
    }
    
    console.log('Updating request status:', { id, status, rejectionReason, adminId });
    
    await request.update({
      status,
      rejectionReason: status === 'rejected' ? rejectionReason : null,
      reviewedBy: adminId, 
      reviewedAt: new Date()
    });
    
    // If approved, update merchant level
    if (status === 'approved') {
      try {
        const merchant = await Merchant.findByPk(request.merchantId);
        if (merchant) {
          console.log('Updating merchant level for:', merchant.businessName, 'to Tier', request.targetLevel);
          await merchant.update({
            accountLevel: `Tier ${request.targetLevel}`
          });
          console.log('Merchant level updated successfully');
        } else {
          console.warn('Merchant not found for ID:', request.merchantId);
        }
      } catch (merchantUpdateError) {
        console.error('Failed to update merchant level:', merchantUpdateError);
        // We might not want to fail the whole request if only the merchant level update fails, 
        // but it's critical for verification.
      }
    }
    
    res.json({
      message: `Upgrade request ${status} successfully`,
      request
    });
  } catch (error) {
    console.error('Update request status error:', error);
    res.status(500).json({ message: 'Failed to update request status', error: error.message });
  }
};

// Get request details (Admin & Merchant)
const getRequestDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await WalletUpgradeRequest.findByPk(id, {
      include: [
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName', 'email', 'phone', 'accountLevel']
        },
        {
          model: AdminStaff,
          as: 'Reviewer',
          attributes: ['id', 'fullName']
        }
      ]
    });
    
    if (!request) {
      return res.status(404).json({ message: 'Upgrade request not found' });
    }
    
    res.json({
      message: 'Upgrade request retrieved successfully',
      request
    });
  } catch (error) {
    console.error('Get request details error:', error);
    res.status(500).json({ message: 'Failed to retrieve upgrade request', error: error.message });
  }
};

module.exports = {
  submitUpgradeRequest,
  listUpgradeRequests,
  updateRequestStatus,
  getRequestDetails
};
