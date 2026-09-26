const db = require('../models');
const { Charge, ChargeAssignment, Customer, Merchant, CustomerWallet, WalletTransaction } = db;
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Charges
 *     description: Charge management
 * /charges:
 *   get:
 *     summary: List charges
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Charges list retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               charges:
 *                 - id: 1
 *                   chargeName: "Processing Fee"
 *                   type: "Service"
 *                   amount: "N1,000"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create charge
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chargeName, type, amount]
 *             properties:
 *               chargeName: 
 *                 type: string
 *                 description: Name of the charge
 *                 example: "Processing Fee"
 *               type: 
 *                 type: string
 *                 enum: [Loan, Penalty, Service]
 *                 description: Type of charge
 *                 example: "Service"
 *               amount: 
 *                 type: number
 *                 format: float
 *                 description: Charge amount
 *                 example: 100.50
 *     responses:
 *       201:
 *         description: Charge created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Charge created successfully"
 *               charge:
 *                 id: 2
 *                 chargeName: "Late Fee"
 *                 type: "Penalty"
 *                 amount: "N500"
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   put:
 *     summary: Update charge
 *     tags: [Charges]
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
 *               id: 
 *                 type: integer
 *                 description: Charge ID
 *                 example: 1
 *               chargeName: 
 *                 type: string
 *                 description: Name of the charge
 *                 example: "Updated Processing Fee"
 *               type: 
 *                 type: string
 *                 enum: [Loan, Penalty, Service]
 *                 description: Type of charge
 *                 example: "Service"
 *               amount: 
 *                 type: number
 *                 format: float
 *                 description: Charge amount
 *                 example: 150.75
 *     responses:
 *       200:
 *         description: Charge updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Charge updated successfully"
 *               charge:
 *                 id: 1
 *                 chargeName: "Processing Fee"
 *                 type: "Service"
 *                 amount: "N1,500"
 *       404:
 *         description: Charge not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /charges/{id}:
 *   delete:
 *     summary: Delete charge
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: 
 *           type: integer
 *         description: Charge ID
 *     responses:
 *       200:
 *         description: Charge deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Charge deleted successfully"
 *       404:
 *         description: Charge not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /charges/assign:
 *   post:
 *     summary: Assign charge to customer
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chargeName, amount, dueDate, customer]
 *             properties:
 *               chargeName: 
 *                 type: string
 *                 description: Name of the charge
 *                 example: "Processing Fee"
 *               amount: 
 *                 type: number
 *                 format: float
 *                 description: Charge amount
 *                 example: 100.50
 *               dueDate: 
 *                 type: string
 *                 format: date
 *                 description: Due date for the charge
 *                 example: "2024-12-31"
 *               customer: 
 *                 type: string
 *                 description: Customer name
 *                 example: "John Doe"
 *     responses:
 *       201:
 *         description: Charge assigned successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Charge assigned successfully"
 *               assignment:
 *                 id: 11
 *                 chargeName: "Processing Fee"
 *                 customer: "John Doe"
 *                 amount: "N1,000"
 *                 dueDate: "31 Dec 2025"
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /charges/history:
 *   get:
 *     summary: Get charge history
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Charge assignments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 assignments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       chargeName:
 *                         type: string
 *                         example: "Processing Fee"
 *                       amount:
 *                         type: number
 *                         format: float
 *                         example: 100.50
 *                       dueDate:
 *                         type: string
 *                         format: date
 *                         example: "2024-12-31"
 *                       customer:
 *                         type: string
 *                         example: "John Doe"
 *                       status:
 *                         type: string
 *                         example: "Pending"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /charges/assignments/status:
 *   put:
 *     summary: Update assignment status
 *     tags: [Charges]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: 
 *                 type: integer
 *                 description: Assignment ID
 *                 example: 1
 *               status: 
 *                 type: string
 *                 enum: [Pending, Paid]
 *                 description: New status
 *                 example: "Paid"
 *     responses:
 *       200:
 *         description: Assignment status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Assignment status updated successfully"
 *                 assignment:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     status:
 *                       type: string
 *                       example: "Paid"
 *       404:
 *         description: Assignment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Create a new charge
exports.createCharge = async (req, res) => {
  try {
    const { chargeName, type, amount } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    // Validate required fields
    if (!chargeName || !type || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Charge name, type, and amount are required'
      });
    }

    // Validate type
    const validTypes = ['Loan', 'Penalty', 'Service'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid charge type. Must be one of: Loan, Penalty, Service'
      });
    }

    // Normalize amount (supports raw number or currency-formatted string)
    const normalizedAmount = typeof amount === 'string'
      ? parseFloat(amount.replace(/[^\d.-]/g, ''))
      : Number(amount);
    if (Number.isNaN(normalizedAmount)) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Create the charge
    const charge = await Charge.create({
      chargeName,
      type,
      amount: normalizedAmount,
      merchantId
    });

    res.status(201).json({
      success: true,
      message: 'Charge created successfully',
      charge: {
        id: charge.id,
        chargeName: charge.chargeName,
        type: charge.type,
        amount: `N${Number(charge.amount || 0).toLocaleString()}`,
        activeCustomers: 0,
        lastUpdated: (charge.updatedAt ? charge.updatedAt : new Date()).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      }
    });
  } catch (error) {
    console.error('Create charge error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all charges for a merchant
exports.getCharges = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;

    const charges = await Charge.findAll({
      where: {
        merchantId,
        isActive: true
      },
      include: [
        {
          model: ChargeAssignment,
          attributes: ['id'],
          required: false
        }
      ],
      order: [['updatedAt', 'DESC']]
    });

    const formattedCharges = charges.map(charge => ({
      id: charge.id,
      chargeName: charge.chargeName,
      type: charge.type,
      amount: `N${Number(charge.amount || 0).toLocaleString()}`,
      activeCustomers: charge.ChargeAssignments ? charge.ChargeAssignments.length : 0,
      lastUpdated: (charge.updatedAt ? charge.updatedAt : new Date()).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    }));

    res.json({
      success: true,
      charges: formattedCharges
    });
  } catch (error) {
    console.error('Get charges error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Assign charge to customer(s) — deducts immediately from collectionBalance (allows negative)
exports.assignCharge = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { chargeName, amount, dueDate, customer } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    if (!chargeName || !amount || !dueDate || !customer) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const charge = await Charge.findOne({
      where: { chargeName, merchantId, isActive: true },
      transaction
    });
    if (!charge) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    const normalizedAssignmentAmount = typeof amount === 'string'
      ? parseFloat(amount.replace(/[^\d.-]/g, ''))
      : Number(amount);
    if (Number.isNaN(normalizedAssignmentAmount)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Determine target customer(s)
    let targetCustomers = [];
    if (typeof customer === 'string' && (customer.toLowerCase() === 'all' || customer === 'ALL_CUSTOMERS' || customer === 'All Customers')) {
      targetCustomers = await Customer.findAll({
        where: { merchantId },
        transaction
      });
      if (targetCustomers.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'No customers found for this merchant' });
      }
    } else {
      const customerIdNum = Number(customer);
      const customerRecord = await Customer.findOne({
        where: {
          merchantId,
          [Op.or]: [
            { fullName: customer },
            ...(Number.isFinite(customerIdNum) ? [{ id: customerIdNum }] : [])
          ]
        },
        transaction
      });

      if (!customerRecord) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
      targetCustomers = [customerRecord];
    }

    const createdAssignments = [];
    for (const cust of targetCustomers) {
      // Deduct immediately from customer wallet — allow balance to go negative
      const wallet = await CustomerWallet.findOne({
        where: { customerId: cust.id, merchantId },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      const oldBalance = wallet ? parseFloat(wallet.collectionBalance || 0) : 0;
      const newBalance = oldBalance - normalizedAssignmentAmount;

      if (wallet) {
        await wallet.update({ collectionBalance: newBalance }, { transaction });
      } else {
        // Create wallet with negative balance if it doesn't exist
        await CustomerWallet.create({
          customerId: cust.id,
          merchantId,
          collectionBalance: newBalance
        }, { transaction });
      }

      // Create the assignment with status 'Paid' (deducted immediately)
      const assignment = await ChargeAssignment.create({
        chargeId: charge.id,
        customerId: cust.id,
        amount: normalizedAssignmentAmount,
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
        amount: normalizedAssignmentAmount,
        description: `Charge Applied: ${charge.chargeName}`,
        status: 'Completed',
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        category: 'charge',
        relatedId: assignment.id,
        relatedType: 'ChargeAssignment'
      }, { transaction });

      createdAssignments.push(assignment);
    }

    await transaction.commit();

    const firstAssignment = createdAssignments[0];
    const isBulk = targetCustomers.length > 1;

    res.status(201).json({
      success: true,
      message: isBulk
        ? `Charge assigned and deducted for all ${targetCustomers.length} customers successfully`
        : 'Charge assigned and deducted successfully',
      assignment: {
        id: firstAssignment.id,
        chargeName: charge.chargeName,
        customerName: isBulk ? `All (${targetCustomers.length} customers)` : targetCustomers[0].fullName,
        amount: `N${Number(normalizedAssignmentAmount || 0).toLocaleString()}`,
        dueDate: (firstAssignment.dueDate ? firstAssignment.dueDate : new Date()).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }),
        dateApplied: new Date().toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }),
        status: 'Paid'
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error assigning charge:', error);
    res.status(500).json({ success: false, message: 'Failed to assign charge', error: error.message });
  }
};

// Get charge history (assignments)
exports.getChargeHistory = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { customerId } = req.query;

    const whereClause = { merchantId };
    if (customerId) {
      whereClause.customerId = parseInt(customerId);
    }

    const assignments = await ChargeAssignment.findAll({
      where: whereClause,
      include: [
        {
          model: Charge,
          attributes: ['chargeName'],
          required: false
        },
        {
          model: Customer,
          attributes: ['fullName', 'accountNumber'],
          required: false
        }
      ],
      order: [['dateApplied', 'DESC']]
    });

    const formattedHistory = assignments.map(assignment => ({
      id: assignment.id,
      customerName: assignment.Customer?.fullName || 'N/A',
      accountNumber: assignment.Customer?.accountNumber || 'N/A',
      chargeName: assignment.Charge?.chargeName || '—',
      amount: Number(assignment.amount || 0),
      dueDate: (assignment.dueDate ? assignment.dueDate : new Date()).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      dateApplied: (assignment.dateApplied ? assignment.dateApplied : new Date()).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      createdAt: assignment.createdAt,
      status: assignment.status
    }));

    res.json({
      success: true,
      history: formattedHistory
    });
  } catch (error) {
    console.error('Get charge history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update charge
exports.updateCharge = async (req, res) => {
  try {
    const { id, chargeName, type, amount } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    const charge = await Charge.findOne({
      where: {
        id,
        merchantId
      }
    });

    if (!charge) {
      return res.status(404).json({
        success: false,
        message: 'Charge not found'
      });
    }

    // Update charge
    const normalizedUpdateAmount = amount === undefined || amount === null ? undefined : (
      typeof amount === 'string' ? parseFloat(amount.replace(/[^\d.-]/g, '')) : Number(amount)
    );
    if (normalizedUpdateAmount !== undefined && Number.isNaN(normalizedUpdateAmount)) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    await charge.update({
      chargeName: chargeName || charge.chargeName,
      type: type || charge.type,
      amount: normalizedUpdateAmount !== undefined ? normalizedUpdateAmount : charge.amount
    });

    res.json({
      success: true,
      message: 'Charge updated successfully',
      charge: {
        id: charge.id,
        chargeName: charge.chargeName,
        type: charge.type,
        amount: `N${Number(charge.amount || 0).toLocaleString()}`,
        lastUpdated: charge.updatedAt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      }
    });
  } catch (error) {
    console.error('Update charge error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete charge
exports.deleteCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.merchantId || req.user.id;

    const charge = await Charge.findOne({
      where: {
        id,
        merchantId
      }
    });

    if (!charge) {
      return res.status(404).json({
        success: false,
        message: 'Charge not found'
      });
    }

    // Soft delete by setting isActive to false
    await charge.update({ isActive: false });

    res.json({
      success: true,
      message: 'Charge deleted successfully'
    });
  } catch (error) {
    console.error('Delete charge error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update charge assignment status
// Note: deduction is now done at assignment time in assignCharge.
// This endpoint only updates the status label (no further wallet deduction).
exports.updateChargeAssignmentStatus = async (req, res) => {
  try {
    const { id, status } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    const assignment = await ChargeAssignment.findOne({
      where: { id, merchantId }
    });

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Charge assignment not found' });
    }

    await assignment.update({ status });

    res.json({
      success: true,
      message: `Charge assignment status updated to ${status} successfully`
    });
  } catch (error) {
    console.error('Update charge assignment status error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
