const { Investment, Customer } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Investments
 *     description: Investment management
 * /investments:
 *   get:
 *     summary: List investments
 *     tags: [Investments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Investments list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               investments:
 *                 - id: 700
 *                   customerId: 12
 *                   customerName: "Jane Doe"
 *                   accountNumber: "ACC123456"
 *                   amount: 100000.00
 *                   interestRate: 12.5
 *                   plan: "Fixed"
 *                   duration: 180
 *                   agentId: 3
 *                   agentName: "Agent Smith"
 *                   branch: "Main Branch"
 *                   status: "Active"
 *                   merchantId: 1
 *                   startDate: "2024-01-15T00:00:00.000Z"
 *                   maturityDate: "2024-07-15T00:00:00.000Z"
 *                   expectedReturns: 120000.00
 *                   actualReturns: 0.00
 *                   notes: "Long-term investment for retirement"
 *                   approvedBy: 2
 *                   approvedAt: "2024-01-15T14:30:00.000Z"
 *                   totalReturn: 120000.00
 *                   currentValue: 105000.00
 *                   dateCreated: "2024-01-15T10:30:00.000Z"
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *   post:
 *     summary: Create investment
 *     tags: [Investments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, amount, plan, duration]
 *             properties:
 *               customerName: { type: string }
 *               amount: { type: number, format: float }
 *               plan: { type: string }
 *               duration: { type: integer }
 *     responses:
 *       201:
 *         description: Investment created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Investment created successfully"
 *               investment:
 *                 id: 701
 *                 customerId: 12
 *                 customerName: "Jane Doe"
 *                 accountNumber: "ACC123456"
 *                 amount: 150000.00
 *                 interestRate: 12.5
 *                 plan: "Flexible"
 *                 duration: 90
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 status: "Active"
 *                 merchantId: 1
 *                 startDate: "2024-01-15T00:00:00.000Z"
 *                 maturityDate: "2024-04-15T00:00:00.000Z"
 *                 expectedReturns: 120000.00
 *                 actualReturns: 0.00
 *                 notes: "Short-term flexible investment"
 *                 approvedBy: 2
 *                 approvedAt: "2024-01-15T14:30:00.000Z"
 *                 totalReturn: 120000.00
 *                 currentValue: 105000.00
 *                 dateCreated: "2024-01-15T10:30:00.000Z"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 * /investments/{id}:
 *   get:
 *     summary: Get investment by ID
 *     tags: [Investments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Investment retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               investment:
 *                 id: 700
 *                 customerId: 12
 *                 customerName: "Jane Doe"
 *                 accountNumber: "ACC123456"
 *                 amount: 100000.00
 *                 interestRate: 12.5
 *                 plan: "Fixed"
 *                 duration: 180
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 status: "Active"
 *                 merchantId: 1
 *                 startDate: "2024-01-15T00:00:00.000Z"
 *                 maturityDate: "2024-07-15T00:00:00.000Z"
 *                 expectedReturns: 120000.00
 *                 actualReturns: 0.00
 *                 notes: "Long-term investment for retirement"
 *                 approvedBy: 2
 *                 approvedAt: "2024-01-15T14:30:00.000Z"
 *                 totalReturn: 120000.00
 *                 currentValue: 105000.00
 *                 dateCreated: "2024-01-15T10:30:00.000Z"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *   delete:
 *     summary: Delete investment (soft)
 *     tags: [Investments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Investment deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Investment deleted successfully"
 *   put:
 *     summary: Update investment
 *     tags: [Investments]
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
 *               customerName: { type: string }
 *               amount: { type: number, format: float }
 *               plan: { type: string }
 *               duration: { type: integer }
 *               status: { type: string }
 */

// Create a new investment
const createInvestment = async (req, res) => {
  try {
    const { customerName, amount, plan, duration } = req.body;
    const merchantId = req.user.id;

    // Find customer by name
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

    const investment = await Investment.create({
      customerId: customer.id,
      customerName,
      amount: parseFloat(amount),
      plan,
      duration: parseInt(duration),
      status: 'Active',
      merchantId,
      dateCreated: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Investment created successfully',
      investment
    });
  } catch (error) {
    console.error('Error creating investment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create investment',
      error: error.message
    });
  }
};

// Get all investments for a merchant
const getInvestments = async (req, res) => {
  try {
    const merchantId = req.user.id;

    const investments = await Investment.findAll({
      where: { merchantId },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      investments
    });
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investments',
      error: error.message
    });
  }
};

// Get investment by ID
const getInvestmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const investment = await Investment.findOne({
      where: { 
        id,
        merchantId 
      },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ]
    });

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    res.json({
      success: true,
      investment
    });
  } catch (error) {
    console.error('Error fetching investment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investment',
      error: error.message
    });
  }
};

// Update investment
const updateInvestment = async (req, res) => {
  try {
    const { id, customerName, amount, plan, duration, status } = req.body;
    const merchantId = req.user.id;

    const investment = await Investment.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    await investment.update({
      customerName: customerName || investment.customerName,
      amount: amount ? parseFloat(amount) : investment.amount,
      plan: plan || investment.plan,
      duration: duration ? parseInt(duration) : investment.duration,
      status: status || investment.status
    });

    res.json({
      success: true,
      message: 'Investment updated successfully',
      investment
    });
  } catch (error) {
    console.error('Error updating investment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update investment',
      error: error.message
    });
  }
};

// Delete investment (soft delete)
const deleteInvestment = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const investment = await Investment.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    await investment.update({ status: 'Deleted' });

    res.json({
      success: true,
      message: 'Investment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting investment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete investment',
      error: error.message
    });
  }
};

module.exports = {
  createInvestment,
  getInvestments,
  getInvestmentById,
  updateInvestment,
  deleteInvestment
};

