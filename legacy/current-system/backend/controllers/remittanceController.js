const { Remittance, Customer, Agent, CustomerWallet, WalletTransaction, Activity, Collection } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Remittances
 *     description: Remittances management
 * /remittances:
 *   get:
 *     summary: List remittances
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Remittances list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               remittances:
 *                 - id: 41
 *                   customerName: "John Doe"
 *                   amount: 25000
 *                   status: "Pending"
 *   post:
 *     summary: Create remittance
 *     responses:
 *       201:
 *         description: Remittance created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Remittance created"
 *               remittance:
 *                 id: 42
 *                 customerName: "Jane Doe"
 *                 amount: 30000
 *                 status: "Pending"
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, amount]
 *             properties:
 *               collectionId: { type: integer }
 *               customerId: { type: integer }
 *               amount: { type: number, format: float }
 *               notes: { type: string }
 *   put:
 *     summary: Update remittance
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               amount: { type: number, format: float }
 *               notes: { type: string }
 * /remittances/{id}:
 *   get:
 *     summary: Get remittance by ID
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Remittance retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               remittance:
 *                 id: 41
 *                 customerName: "John Doe"
 *                 amount: 25000
 *                 status: "Pending"
 *   delete:
 *     summary: Delete remittance
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Remittance deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Remittance deleted"
 * /remittances/{id}/approve:
 *   patch:
 *     summary: Approve remittance
 *     tags: [Remittances]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Remittance approved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Remittance approved"
 *               remittance:
 *                 id: 41
 *                 status: "Approved"
 *
 */

const createRemittance = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { collectionId, customerId, amount, notes } = req.body;
    const customer = await Customer.findOne({ where: { id: customerId, merchantId } });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const remittance = await Remittance.create({
      collectionId: collectionId || null,
      customerId: customer.id,
      customerName: customer.fullName,
      accountNumber: customer.accountNumber || null,
      amount: parseFloat(amount),
      agentId: customer.agentId || null,
      agentName: undefined,
      merchantId,
      status: 'Pending',
      notes: notes || null
    });

    // NOTE: No journal entry is posted when a remittance is created.
    // Per the "remitted only" policy, entries enter the company's books
    // only when the remittance is APPROVED (see approveRemittance).

    res.status(201).json({ success: true, message: 'Remittance created', remittance });
  } catch (error) {
    console.error('createRemittance error:', error);
    res.status(500).json({ success: false, message: 'Failed to create remittance', error: error.message });
  }
};

const listRemittances = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const remittances = await Remittance.findAll({
      where: { merchantId },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'accountNumber'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, remittances });
  } catch (error) {
    console.error('listRemittances error:', error);
    res.status(500).json({ success: false, message: 'Failed to list remittances', error: error.message });
  }
};

const getRemittanceById = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { id } = req.params;
    const remittance = await Remittance.findOne({
      where: { id, merchantId },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'accountNumber'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName'] }
      ]
    });
    if (!remittance) return res.status(404).json({ success: false, message: 'Remittance not found' });
    res.json({ success: true, remittance });
  } catch (error) {
    console.error('getRemittanceById error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remittance', error: error.message });
  }
};

const updateRemittance = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { id, amount, notes } = req.body;
    const remittance = await Remittance.findOne({ where: { id, merchantId } });
    if (!remittance) return res.status(404).json({ success: false, message: 'Remittance not found' });
    await remittance.update({
      amount: amount !== undefined ? parseFloat(amount) : remittance.amount,
      notes: notes !== undefined ? notes : remittance.notes
    });
    res.json({ success: true, message: 'Remittance updated', remittance });
  } catch (error) {
    console.error('updateRemittance error:', error);
    res.status(500).json({ success: false, message: 'Failed to update remittance', error: error.message });
  }
};

const approveRemittance = async (req, res) => {
  const transaction = await Remittance.sequelize.transaction();
  try {
    const { id } = req.params;

    // Resolve merchantId for both merchants, staff (collaborators), and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
      } else if (req.user?.type === 'agent') {
        const { Agent } = require('../models');
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      } else if (req.user?.type === 'collaborator') {
        // Collaborators are usually tied to a merchant through the Staff model
        const { Staff } = require('../models');
        const staffOwner = await Staff.findOne({ where: { email: req.user.email } });
        merchantId = staffOwner ? staffOwner.merchantId : undefined;
      }
    }

    if (!merchantId) {
      await transaction.rollback();
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    // Step 1: Fetch remittance WITH customer data (no lock)
    const remittanceWithCustomer = await Remittance.findOne({
      where: { id, merchantId },
      include: [{ model: Customer, as: 'customer' }],
      transaction
    });

    if (!remittanceWithCustomer) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Remittance not found' });
    }

    if (remittanceWithCustomer.status === 'Approved') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Remittance is already approved' });
    }

    // Step 2: Acquire a row-level lock on the plain remittance row (no joins)
    const remittance = await Remittance.findOne({
      where: { id, merchantId },
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    // Race condition guard after lock acquired
    if (!remittance || remittance.status === 'Approved') {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Remittance is already approved' });
    }

    // Step 3: Mark remittance as Approved
    await remittance.update({
      status: 'Approved',
      approvedAt: new Date()
    }, { transaction });

    const customerId = remittance.customerId;
    const customerAccountNumber = remittanceWithCustomer.customer?.accountNumber;

    // Determine whether this remittance settles a first-saving (income) charge.
    // Such amounts are COMPANY INCOME — remitted once at day 1, never credited
    // to the customer's savings wallet.
    let isIncomeCharge = false;
    let linkedCollection = null;
    if (remittance.collectionId) {
      linkedCollection = await Collection.findByPk(remittance.collectionId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      isIncomeCharge = !!(linkedCollection &&
        (linkedCollection.isFirstCollection === true || linkedCollection.isFirstCollection === 'true'));
    }

    // Step 4: Lock and update customer wallet (skipped for income charges)
    let wallet = null;
    let oldBalance = 0;
    let newBalance = isIncomeCharge ? 0 : parseFloat(remittance.amount);

    if (!isIncomeCharge) {
      wallet = await CustomerWallet.findOne({
        where: { customerId, merchantId },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!wallet) {
        wallet = await CustomerWallet.create({
          customerId,
          merchantId,
          accountNumber: customerAccountNumber || `CW${Date.now()}`,
          collectionBalance: newBalance,
          status: 'Active',
          activationDate: new Date()
        }, { transaction });
      } else {
        oldBalance = parseFloat(wallet.collectionBalance) || 0;
        newBalance = oldBalance + parseFloat(remittance.amount);
        await wallet.update({
          collectionBalance: newBalance,
          lastTransactionDate: new Date()
        }, { transaction });
      }
    }

    // Step 4.5: Book the journal entry. Per the "remitted only" policy this is
    // the SINGLE moment a collection enters the company's books:
    //   - regular collection  -> COLLECTION_RECEIVED (Dr Cash / Cr Customer Savings)
    //   - first-saving charge -> CHARGE_DEDUCTION   (Dr Cash / Cr Charges - Collection) = income
    try {
      const { postJournalForTransaction } = require('../utils/transactionMapping');
      if (isIncomeCharge) {
        await postJournalForTransaction(
          'CHARGE_DEDUCTION',
          parseFloat(remittance.amount),
          merchantId,
          `First Saving Charge (Remitted) — Remittance #${remittance.id} — Customer: ${remittanceWithCustomer.customer?.fullName || 'N/A'}`,
          transaction
        );
      } else {
        await postJournalForTransaction(
          'COLLECTION_RECEIVED',
          parseFloat(remittance.amount),
          merchantId,
          `Remittance #${remittance.id} Approved — Customer: ${remittanceWithCustomer.customer?.fullName || 'N/A'}`,
          transaction
        );
      }
    } catch (deErr) {
      console.warn('⚠️ Double-entry skipped for remittance approval:', deErr.message);
    }

    // Step 5: Record wallet ledger entry (only when savings are credited)
    if (!isIncomeCharge && wallet) {
      await WalletTransaction.create({
        transactionType: 'remittance_approval',
        merchantId,
        type: 'credit',
        amount: parseFloat(remittance.amount),
        description: `Remittance #${remittance.id} Approved`,
        status: 'Completed',
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        category: 'collection',
        relatedId: remittance.id,
        relatedType: 'Remittance',
        paymentMethod: remittance.source || 'Web',
        // Fix: Removed processedBy to avoid "fk_wallet_transactions_processed_by" crash 
        // as req.user.id refers to merchants/collaborators table, not the users table.
        processedBy: null
      }, { transaction });
    }

    // Step 6: Update linked Collection if present
    if (linkedCollection) {
      await linkedCollection.update({
        status: 'Collected',
        collectedDate: new Date(),
        amountCollected: remittance.amount
      }, { transaction });
    }

    // Step 7: Audit log
    await Activity.create({
      merchantId,
      person: (req.user && req.user.type === 'collaborator') ? 'staff' : 'merchant',
      staffId: (req.user && req.user.type === 'collaborator') ? req.user.id : null,
      action: 'APPROVE_REMITTANCE',
      details: `Approved remittance #${remittance.id} for amount ${remittance.amount}`
    }, { transaction });

    await transaction.commit();
    res.json({
      success: true,
      message: 'Remittance approved and customer balance updated',
      remittance,
      newBalance
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('approveRemittance error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve remittance', error: error.message });
  }
};

const deleteRemittance = async (req, res) => {
  const transaction = await Remittance.sequelize.transaction();
  try {
    const { id } = req.params;

    // Resolve merchantId for both merchants, staff (collaborators), and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
      } else if (req.user?.type === 'agent') {
        const { Agent } = require('../models');
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      } else if (req.user?.type === 'collaborator') {
        const { Staff } = require('../models');
        const staffOwner = await Staff.findOne({ where: { email: req.user.email } });
        merchantId = staffOwner ? staffOwner.merchantId : undefined;
      }
    }

    if (!merchantId) {
      await transaction.rollback();
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    const remittance = await Remittance.findOne({ 
      where: { id, merchantId },
      transaction 
    });

    if (!remittance) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Remittance not found' });
    }
    
    // Capture the first-saving (income) flag BEFORE the collection is destroyed,
    // so the reversal knows whether this was an income charge (CHARGE_DEDUCTION)
    // or a regular collection entry (COLLECTION_RECEIVED). Destroying it first
    // would make the lookup return null and misclassify the reversal.
    let isIncomeCharge = false;
    const linkedCollection = remittance.collectionId
      ? await Collection.findByPk(remittance.collectionId, { transaction })
      : null;
    if (linkedCollection) {
      isIncomeCharge = (linkedCollection.isFirstCollection === true || linkedCollection.isFirstCollection === 'true');
      await linkedCollection.destroy({ transaction });
    }

    // Log the deletion activity
    await Activity.create({
      merchantId,
      person: (req.user && req.user.type === 'collaborator') ? 'staff' : 'merchant',
      staffId: (req.user && req.user.type === 'collaborator') ? req.user.id : null,
      action: 'DELETE_REMITTANCE',
      details: `Permanently deleted remittance #${remittance.id} (Amount: ${remittance.amount}) and its associated collection records.`
    }, { transaction });

    // Reverse the journal entry that was booked at approval (if any).
    // Per the "remitted only" policy, pending remittances have NO journal entry,
    // so nothing is reversed in that case.
    if (remittance.status === 'Approved') {
      try {
        const { postReversalForTransaction } = require('../utils/transactionMapping');
        await postReversalForTransaction(
          isIncomeCharge ? 'CHARGE_DEDUCTION' : 'COLLECTION_RECEIVED',
          parseFloat(remittance.amount),
          merchantId,
          `Original Remittance ID: ${remittance.id}, Customer: ${remittance.customerName || 'N/A'}`,
          transaction
        );
      } catch (err) {
        console.warn(`⚠️ Reversal failed during remittance delete: ${err.message}`);
      }
    }

    await remittance.destroy({ transaction });
    await transaction.commit();

    res.json({ success: true, message: 'Remittance and associated collection deleted' });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('deleteRemittance error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete remittance', error: error.message });
  }
};

module.exports = { createRemittance, listRemittances, getRemittanceById, updateRemittance, approveRemittance, deleteRemittance };


