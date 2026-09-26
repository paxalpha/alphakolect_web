const { Repayment, Loan, Customer, Agent } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Repayments
 *     description: Loan repayment management
 * /repayments:
 *   get:
 *     summary: Get all repayments
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Pending, Completed, Failed, All]
 *         description: Filter by repayment status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by customer name, account number, transaction ID, or agent name
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter from date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter to date
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: integer
 *         description: Filter by agent ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: date
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Repayments retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: 301
 *                   transactionId: "REP-12345"
 *                   loanId: 601
 *                   customerId: 12
 *                   customerName: "John Doe"
 *                   accountNumber: "ACC123456"
 *                   package: "Premium Loan Package"
 *                   amount: 5000.00
 *                   branch: "Main Branch"
 *                   agentId: 3
 *                   agentName: "Agent Smith"
 *                   paymentMethod: "Cash"
 *                   reference: "REP-REF-2024-001"
 *                   notes: "Monthly loan repayment"
 *                   status: "Completed"
 *                   paymentDate: "2024-01-15T10:30:00.000Z"
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *               pagination:
 *                 currentPage: 1
 *                 totalPages: 3
 *                 totalItems: 25
 *                 itemsPerPage: 10
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create a new repayment
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, amount]
 *             properties:
 *               loanId:
 *                 type: integer
 *                 description: Loan ID
 *                 example: 1
 *               customerName:
 *                 type: string
 *                 description: Customer full name
 *                 example: "John Doe"
 *               accountNumber:
 *                 type: string
 *                 description: Customer account number
 *                 example: "ACC123456"
 *               package:
 *                 type: string
 *                 description: Package name
 *                 example: "Premium Package"
 *               amount:
 *                 type: number
 *                 format: float
 *                 description: Repayment amount
 *                 example: 5000
 *               branch:
 *                 type: string
 *                 description: Branch name
 *                 example: "Main Branch"
 *               agentId:
 *                 type: integer
 *                 description: Agent ID handling the repayment
 *                 example: 1
 *               paymentMethod:
 *                 type: string
 *                 description: Payment method
 *                 example: "Cash"
 *               reference:
 *                 type: string
 *                 description: Payment reference
 *                 example: "REF123456"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Partial payment received"
 *     responses:
 *       201:
 *         description: Repayment created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Repayment created successfully"
 *               data:
 *                 id: 302
 *                 transactionId: "REP-67890"
 *                 loanId: 601
 *                 customerId: 12
 *                 customerName: "John Doe"
 *                 accountNumber: "ACC123456"
 *                 package: "Premium Loan Package"
 *                 amount: 7000.00
 *                 branch: "Main Branch"
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 paymentMethod: "Cash"
 *                 reference: "REP-REF-2024-002"
 *                 notes: "Partial payment received"
 *                 status: "Pending"
 *                 paymentDate: "2024-01-15T10:30:00.000Z"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Customer or loan not found
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
 * /repayments/{id}:
 *   get:
 *     summary: Get repayment by ID
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Repayment ID
 *     responses:
 *       200:
 *         description: Repayment retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: 301
 *                 transactionId: "REP-12345"
 *                 amount: 5000
 *                 status: "Completed"
 *       404:
 *         description: Repayment not found
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
 *   delete:
 *     summary: Delete repayment
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Repayment ID
 *     responses:
 *       200:
 *         description: Repayment deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Repayment deleted successfully"
 *       404:
 *         description: Repayment not found
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
 * /repayments/{id}/status:
 *   put:
 *     summary: Update repayment status
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Repayment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Pending, Completed, Failed]
 *                 description: New repayment status
 *                 example: "Completed"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Payment verified and processed"
 *     responses:
 *       200:
 *         description: Repayment status updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Repayment status updated successfully"
 *               data:
 *                 id: 301
 *                 status: "Completed"
 *       404:
 *         description: Repayment not found
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
 * /repayments/stats/summary:
 *   get:
 *     summary: Get repayment statistics summary
 *     tags: [Repayments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Repayment statistics retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 totalRepayments: 80
 *                 completedRepayments: 50
 *                 pendingRepayments: 30
 *                 totalAmount: 450000
 *                 totalCollection: 300000
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Create a new repayment
const createRepayment = async (req, res) => {
  try {
    const { 
      loanId, 
      customerName, 
      accountNumber, 
      package, 
      amount, 
      branch, 
      agentId, 
      paymentMethod, 
      reference, 
      notes 
    } = req.body;
    // Resolve merchantId based on auth context (merchant vs collaborator)
    let merchantId = req.user.id;
    if (req.user && req.user.type === 'collaborator') {
      if (req.user.merchantId) {
        merchantId = req.user.merchantId;
      } else if (req.headers && req.headers['x-merchant-id']) {
        const hdr = Number(req.headers['x-merchant-id']);
        if (Number.isFinite(hdr)) merchantId = hdr;
      }
    }

    // Normalize loanId
    const normalizedLoanId = Number.isFinite(Number(loanId)) ? Number(loanId) : undefined;

    // Find customer first
    const customer = await Customer.findOne({
      where: {
        fullName: customerName,
        merchantId: merchantId
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Resolve Loan after customer is known using a single OR-based query
    const whereOr = [];
    if (normalizedLoanId) {
      whereOr.push({ id: normalizedLoanId });
    }
    if (accountNumber) {
      whereOr.push({ accountNumber });
    }
    if (customer && customer.id) {
      whereOr.push({ customerId: customer.id });
    }
    if (customerName) {
      const trimmed = String(customerName || '').trim();
      whereOr.push({ customerName: { [Op.iLike]: trimmed } });
    }

    let loan = null;
    if (whereOr.length > 0) {
      loan = await Loan.findOne({
        where: { merchantId, [Op.or]: whereOr },
        order: [['dateIssued', 'DESC']]
      });
    }

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Find agent if provided
    let agent = null;
    if (agentId) {
      agent = await Agent.findOne({
        where: {
          id: agentId,
          merchantId: merchantId
        }
      });
    }

    // Generate transaction ID
    const transactionId = `REP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const repayment = await Repayment.create({
      transactionId,
      loanId,
      customerId: customer.id,
      customerName,
      accountNumber: accountNumber || customer.accountNumber || (loan ? loan.accountNumber : null),
      package,
      amount: parseFloat(amount),
      branch,
      agentId: agent ? agent.id : null,
      agentName: agent ? agent.fullName : null,
      merchantId,
      paymentMethod,
      reference,
      notes,
      status: 'Completed'
    });

    // Update loan amount paid and remaining amount
    const currentPaid = parseFloat(loan.amountPaid || 0);
    const payDelta = parseFloat(amount || 0);
    const totalAmt = parseFloat(loan.totalAmount || 0);
    const newAmountPaid = currentPaid + payDelta;
    const newRemainingAmount = Math.max(totalAmt - newAmountPaid, 0);
    

    res.status(201).json({
      success: true,
      message: 'Repayment created successfully',
      data: repayment
    });
  } catch (error) {
    console.error('Error creating repayment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create repayment',
      error: error.message
    });
  }
};

// Get all repayments with filtering, search, and pagination
const getRepayments = async (req, res) => {
  try {
    const { 
      status, 
      search, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 10,
      agentId 
    } = req.query;
    const merchantId = req.user.id;

    const whereClause = { merchantId };

    // Status filter
    if (status && status !== 'All') {
      whereClause.status = status;
    }

    // Date range filter
    if (fromDate && toDate) {
      whereClause.date = {
        [Op.between]: [new Date(fromDate), new Date(toDate)]
      };
    }

    // Agent filter
    if (agentId && agentId !== 'All') {
      whereClause.agentId = agentId;
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { customerName: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { transactionId: { [Op.iLike]: `%${search}%` } },
        { agentName: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const offset = (page - 1) * limit;
    
    const { count, rows: repayments } = await Repayment.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [[req.query.sortBy || 'date', req.query.sortOrder === 'ASC' ? 'ASC' : 'DESC']],
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'phoneNumber', 'accountNumber'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName'] },
        { model: Loan, as: 'loan', attributes: ['id', 'loanAmount', 'totalAmount', 'accountNumber'] }
      ]
    });

    const totalPages = Math.ceil(count / limit);

    // Ensure accountNumber is populated from repayment or fallbacks
    const serialized = repayments.map((r) => {
      const json = r.toJSON();
      const acc = json.accountNumber || json.customer?.accountNumber || json.loan?.accountNumber || null;
      return { ...json, accountNumber: acc };
    });

    res.json({
      success: true,
      data: serialized,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching repayments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch repayments',
      error: error.message
    });
  }
};

// Get repayment by ID
const getRepaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const repayment = await Repayment.findOne({
      where: { id, merchantId },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'phoneNumber', 'email'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName', 'phoneNumber'] },
        { model: Loan, as: 'loan', attributes: ['id', 'loanAmount', 'totalAmount', 'amountPaid', 'remainingAmount'] }
      ]
    });

    if (!repayment) {
      return res.status(404).json({
        success: false,
        message: 'Repayment not found'
      });
    }

    res.json({
      success: true,
      data: repayment
    });
  } catch (error) {
    console.error('Error fetching repayment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch repayment',
      error: error.message
    });
  }
};

// Update repayment status
const updateRepaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const merchantId = req.user.id;

    const repayment = await Repayment.findOne({
      where: { id, merchantId }
    });

    if (!repayment) {
      return res.status(404).json({
        success: false,
        message: 'Repayment not found'
      });
    }

    const updateData = { status };
    if (notes) updateData.notes = notes;

    await repayment.update(updateData);

    res.json({
      success: true,
      message: 'Repayment status updated successfully',
      data: repayment
    });
  } catch (error) {
    console.error('Error updating repayment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update repayment status',
      error: error.message
    });
  }
};

// Delete repayment
const deleteRepayment = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const repayment = await Repayment.findOne({
      where: { id, merchantId }
    });

    if (!repayment) {
      return res.status(404).json({
        success: false,
        message: 'Repayment not found'
      });
    }

    // Update loan amounts before deleting repayment
    const loan = await Loan.findByPk(repayment.loanId);
    if (loan) {
      const newAmountPaid = parseFloat(loan.amountPaid) - parseFloat(repayment.amount);
      const newRemainingAmount = parseFloat(loan.totalAmount) - newAmountPaid;
      
      await loan.update({
        amountPaid: newAmountPaid,
        remainingAmount: newRemainingAmount,
        status: newRemainingAmount > 0 ? 'Active' : 'Completed'
      });
    }

    await repayment.destroy();

    res.json({
      success: true,
      message: 'Repayment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting repayment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete repayment',
      error: error.message
    });
  }
};

// Get repayment statistics
const getRepaymentStats = async (req, res) => {
  try {
    const merchantId = req.user.id;

    const totalRepayments = await Repayment.count({ where: { merchantId } });
    const completedRepayments = await Repayment.count({ where: { merchantId, status: 'Completed' } });
    const pendingRepayments = await Repayment.count({ where: { merchantId, status: 'Pending' } });

    const totalAmount = await Repayment.sum('amount', { where: { merchantId } });
    const totalCollection = await Repayment.sum('amount', { where: { merchantId, status: 'Completed' } });

    res.json({
      success: true,
      data: {
        totalRepayments,
        completedRepayments,
        pendingRepayments,
        totalAmount: totalAmount || 0,
        totalCollection: totalCollection || 0
      }
    });
  } catch (error) {
    console.error('Error fetching repayment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch repayment statistics',
      error: error.message
    });
  }
};

module.exports = {
  createRepayment,
  getRepayments,
  getRepaymentById,
  updateRepaymentStatus,
  deleteRepayment,
  getRepaymentStats
};




