const { LoanApplication, Customer, Agent, Staff, Loan } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Loan Applications
 *     description: Loan application management
 * /loan-applications:
 *   get:
 *     summary: Get all loan applications
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Pending, Approved, Rejected, Completed]
 *         description: Filter by application status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by customer name, account number, or agent name
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
 *     responses:
 *       200:
 *         description: Loan applications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 applications:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LoanApplication'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalItems:
 *                       type: integer
 *                     itemsPerPage:
 *                       type: integer
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create a new loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, requestedAmount, interestRate, duration]
 *             properties:
 *               customerName:
 *                 type: string
 *                 description: Customer full name
 *                 example: "John Doe"
 *               accountNumber:
 *                 type: string
 *                 description: Customer account number
 *                 example: "ACC123456"
 *               requestedAmount:
 *                 type: number
 *                 format: float
 *                 description: Requested loan amount
 *                 example: 50000
 *               interestRate:
 *                 type: number
 *                 format: float
 *                 description: Interest rate percentage
 *                 example: 15.5
 *               duration:
 *                 type: integer
 *                 description: Loan duration in days
 *                 example: 90
 *               agentId:
 *                 type: integer
 *                 description: Agent ID handling the application
 *                 example: 1
 *               branch:
 *                 type: string
 *                 description: Branch name
 *                 example: "Main Branch"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Customer has good credit history"
 *               purpose:
 *                 type: string
 *                 description: Loan purpose
 *                 example: "Business expansion"
 *               collateral:
 *                 type: string
 *                 description: Collateral description
 *                 example: "Property deed"
 *     responses:
 *       201:
 *         description: Loan application created successfully
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
 *                   example: "Loan application created successfully"
 *                 application:
 *                   $ref: '#/components/schemas/LoanApplication'
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
 * /loan-applications/{id}:
 *   get:
 *     summary: Get loan application by ID
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Loan application retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 application:
 *                   $ref: '#/components/schemas/LoanApplication'
 *       404:
 *         description: Loan application not found
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
 *     summary: Delete loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan application ID
 *     responses:
 *       200:
 *         description: Loan application deleted successfully
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
 *                   example: "Loan application deleted successfully"
 *       404:
 *         description: Loan application not found
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
 * /loan-applications/{id}/status:
 *   put:
 *     summary: Update loan application status
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan application ID
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
 *                 enum: [Pending, Approved, Rejected, Completed]
 *                 description: New application status
 *                 example: "Approved"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Application approved after review"
 *               rejectionReason:
 *                 type: string
 *                 description: Reason for rejection (if status is Rejected)
 *                 example: "Insufficient documentation"
 *     responses:
 *       200:
 *         description: Application status updated successfully
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
 *                   example: "Application approved successfully"
 *                 application:
 *                   $ref: '#/components/schemas/LoanApplication'
 *       404:
 *         description: Loan application not found
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

// Create a new loan application
const createLoanApplication = async (req, res) => {
  try {
    const { 
      customerName, 
      accountNumber, 
      requestedAmount, 
      interestRate, 
      duration, 
      agentId, 
      branch, 
      notes,
      purpose,
      collateral,
      packageName
    } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    // Check for running loan on this account number
    if (accountNumber) {
      const activeLoan = await Loan.findOne({
        where: {
          accountNumber,
          merchantId,
          status: { [Op.not]: 'Completed' }
        }
      });

      if (activeLoan) {
        return res.status(400).json({
          success: false,
          message: 'A loan is already running on this account number. It must be fully paid off before applying for another.'
        });
      }
    }

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

    // Get agent details if provided
    let agentName = null;
    if (agentId) {
      const agent = await Agent.findByPk(agentId);
      agentName = agent ? agent.fullName : null;
    }

    const application = await LoanApplication.create({
      customerId: customer.id,
      customerName,
      accountNumber: accountNumber || customer.accountNumber,
      requestedAmount: parseFloat(requestedAmount),
      interestRate: parseFloat(interestRate),
      duration: parseInt(duration),
      agentId,
      agentName,
      branch,
      notes,
      purpose,
      collateral,
      packageName,
      merchantId,
      dateApplied: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Loan application created successfully',
      application
    });
  } catch (error) {
    console.error('Error creating loan application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create loan application',
      error: error.message
    });
  }
};

// Get all loan applications for a merchant
const getLoanApplications = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { 
      status, 
      search, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 10,
      customerId
    } = req.query;

    const whereClause = { merchantId };

    // Add customer filter
    if (customerId) {
      whereClause.customerId = parseInt(customerId);
    }
    
    // Add status filter
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    // Add date range filter
    if (fromDate || toDate) {
      whereClause.dateApplied = {};
      if (fromDate) {
        whereClause.dateApplied[Op.gte] = new Date(fromDate);
      }
      if (toDate) {
        whereClause.dateApplied[Op.lte] = new Date(toDate);
      }
    }

    // Add search filter
    if (search) {
      whereClause[Op.or] = [
        { customerName: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { agentName: { [Op.iLike]: `%${search}%` } }
      ];
    }


    const offset = (page - 1) * limit;
    
    const { count, rows: applications } = await LoanApplication.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        },
        {
          model: Agent,
          as: 'agent',
          attributes: ['id', 'fullName', 'phoneNumber']
        }
      ],
      order: [['dateApplied', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      applications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching loan applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan applications',
      error: error.message
    });
  }
};

// Get loan application by ID
const getLoanApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.merchantId || req.user.id;

    const application = await LoanApplication.findOne({
      where: { 
        id,
        merchantId 
      },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        },
        {
          model: Agent,
          as: 'agent',
          attributes: ['id', 'fullName', 'phoneNumber']
        }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Loan application not found'
      });
    }

    res.json({
      success: true,
      application
    });
  } catch (error) {
    console.error('Error fetching loan application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan application',
      error: error.message
    });
  }
};

// Update loan application status
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, rejectionReason } = req.body;
    const merchantId = req.user.merchantId || req.user.id;
    const staffId = req.user.id; // Assuming staff ID is available

    const application = await LoanApplication.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Loan application not found'
      });
    }

    const updateData = { status };
    
    if (status === 'Approved') {
      updateData.approvedBy = staffId;
      updateData.approvedAt = new Date();
    } else if (status === 'Rejected') {
      updateData.rejectionReason = rejectionReason;
    }

    if (notes) {
      updateData.notes = notes;
    }

    await application.update(updateData);

    res.json({
      success: true,
      message: `Application ${status.toLowerCase()} successfully`,
      application
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status',
      error: error.message
    });
  }
};

// Delete loan application
const deleteLoanApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.merchantId || req.user.id;

    const application = await LoanApplication.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Loan application not found'
      });
    }

    await application.destroy();

    res.json({
      success: true,
      message: 'Loan application deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting loan application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete loan application',
      error: error.message
    });
  }
};

module.exports = {
  createLoanApplication,
  getLoanApplications,
  getLoanApplicationById,
  updateApplicationStatus,
  deleteLoanApplication
};
