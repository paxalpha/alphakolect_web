const db = require('../models');
const { Charge, ChargeAssignment, Customer, Merchant } = db;
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Charges
 *     description: Charge management
 */

// Create a new charge
exports.createCharge = async (req, res) => {
  try {
    const { chargeName, type, amount } = req.body;
    const merchantId = req.user.id;

    if (!chargeName || !type || !amount) {
      return res.status(400).json({ success: false, message: 'Charge name, type, and amount are required' });
    }

    const normalizedAmount = typeof amount === 'string' ? parseFloat(amount.replace(/[^\d.-]/g, '')) : Number(amount);
    
    const charge = await Charge.create({
      chargeName,
      type,
      amount: normalizedAmount,
      merchantId
    });

    res.status(201).json({
      success: true,
      message: 'Charge created successfully',
      charge
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Get all charges for a merchant
exports.getCharges = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const charges = await Charge.findAll({
      where: { merchantId, isActive: true },
      order: [['updatedAt', 'DESC']]
    });

    res.json({ success: true, charges });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Assign/Apply charge to customer (Deducts from Collection Wallet)
exports.assignCharge = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { chargeName, amount, dueDate, customer } = req.body;
    const merchantId = req.user.id;

    if (!chargeName || !amount || !dueDate || !customer) {
      if (transaction) await transaction.rollback();
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const charge = await Charge.findOne({ where: { chargeName, merchantId, isActive: true }, transaction });
    if (!charge) {
      if (transaction) await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Charge template not found' });
    }

    // Customer can be ID or Name
    const customerRecord = await Customer.findOne({ 
      where: { 
        [Op.or]: [
          { fullName: customer }, 
          { id: isNaN(Number(customer)) ? -1 : Number(customer) }
        ], 
        merchantId 
      }, 
      transaction 
    });
    
    if (!customerRecord) {
      if (transaction) await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const normalizedAmount = typeof amount === 'string' ? parseFloat(amount.replace(/[^\d.-]/g, '')) : Number(amount);
    
    const { CustomerWallet, WalletTransaction } = db;
    let wallet = await CustomerWallet.findOne({ 
      where: { customerId: customerRecord.id, merchantId }, 
      lock: transaction.LOCK.UPDATE, 
      transaction 
    });
    
    if (!wallet || parseFloat(wallet.collectionBalance || 0) < normalizedAmount) {
      if (transaction) await transaction.rollback();
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient collection balance. Current: ₦${Number(wallet?.collectionBalance || 0).toLocaleString()}. Please fund the collection wallet.` 
      });
    }

    const oldBalance = parseFloat(wallet.collectionBalance);
    const newBalance = oldBalance - normalizedAmount;
    
    await wallet.update({ collectionBalance: newBalance }, { transaction });

    // Create assignment marked as Paid
    const assignment = await ChargeAssignment.create({
      chargeId: charge.id,
      customerId: customerRecord.id,
      amount: normalizedAmount,
      dueDate: new Date(dueDate),
      merchantId,
      status: 'Paid',
      datePaid: new Date()
    }, { transaction });

    // Record wallet transaction
    await WalletTransaction.create({
      transactionType: 'charge_deduction',
      merchantId,
      type: 'debit',
      amount: normalizedAmount,
      description: `Charge Applied: ${chargeName}`,
      status: 'Completed',
      balanceBefore: oldBalance,
      balanceAfter: newBalance,
      category: 'charge',
      relatedId: assignment.id,
      relatedType: 'ChargeAssignment'
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Charge applied and deducted from collection wallet successfully',
      assignment
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('Assign charge error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Get charge history (assignments)
exports.getChargeHistory = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const assignments = await ChargeAssignment.findAll({
      where: { merchantId },
      include: [
        { model: Charge, attributes: ['chargeName'] },
        { model: Customer, attributes: ['fullName', 'accountNumber'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({ success: true, history: assignments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Update charge
exports.updateCharge = async (req, res) => {
  try {
    const { id, chargeName, type, amount } = req.body;
    const merchantId = req.user.id;
    const charge = await Charge.findOne({ where: { id, merchantId } });
    if (!charge) return res.status(404).json({ success: false, message: 'Charge not found' });
    
    await charge.update({
      chargeName: chargeName || charge.chargeName,
      type: type || charge.type,
      amount: amount !== undefined ? parseFloat(String(amount).replace(/[^\d.-]/g, '')) : charge.amount
    });
    res.json({ success: true, message: 'Charge updated successfully', charge });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Delete charge
exports.deleteCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;
    const charge = await Charge.findOne({ where: { id, merchantId } });
    if (!charge) return res.status(404).json({ success: false, message: 'Charge not found' });
    await charge.update({ isActive: false });
    res.json({ success: true, message: 'Charge deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

// Update charge assignment status (and deduct from wallet if Paid)
exports.updateChargeAssignmentStatus = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id, status } = req.body;
    const merchantId = req.user.id;
    const assignment = await ChargeAssignment.findOne({ 
      where: { id, merchantId },
      include: [{ model: Charge, attributes: ['chargeName'] }],
      transaction 
    });

    if (!assignment) {
      if (transaction) await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Charge assignment not found' });
    }
    
    if (assignment.status === 'Paid' && status === 'Paid') {
      if (transaction) await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Charge is already paid' });
    }

    const updateData = { status };
    if (status === 'Paid') {
      updateData.datePaid = new Date();

      // Deduct from wallet
      const { CustomerWallet, WalletTransaction } = db;
      let wallet = await CustomerWallet.findOne({ 
        where: { customerId: assignment.customerId, merchantId }, 
        lock: transaction.LOCK.UPDATE, 
        transaction 
      });
      
      const amount = parseFloat(assignment.amount);
      if (!wallet || parseFloat(wallet.collectionBalance || 0) < amount) {
        if (transaction) await transaction.rollback();
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient collection balance. Current: ₦${Number(wallet?.collectionBalance || 0).toLocaleString()}.` 
        });
      }

      const oldBalance = parseFloat(wallet.collectionBalance);
      const newBalance = oldBalance - amount;
      await wallet.update({ collectionBalance: newBalance }, { transaction });

      // Record wallet transaction
      await WalletTransaction.create({
        transactionType: 'charge_deduction',
        merchantId,
        type: 'debit',
        amount: amount,
        description: `Charge Paid: ${assignment.Charge?.chargeName || 'Charge'}`,
        status: 'Completed',
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        category: 'charge',
        relatedId: assignment.id,
        relatedType: 'ChargeAssignment'
      }, { transaction });
    }

    await assignment.update(updateData, { transaction });
    await transaction.commit();

    res.json({ success: true, message: `Charge assignment status updated to ${status} successfully` });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('Update charge assignment status error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
