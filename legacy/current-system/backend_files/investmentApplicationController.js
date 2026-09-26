const { InvestmentApplication, Customer, Agent, Staff } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Investment Applications
 *     description: Investment application management
 * /investment-applications:
 *   get:
 *     summary: Get all investment applications
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Pending, Approved, Rejected, Completed, all]
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
 *         description: Investment applications retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               applications:
 *                 - id: 51
 *                   customerName: "Jane Doe"
 *                   accountNumber: "ACC123456"
 *                   targetAmount: 150000.00
 *                   duration: 180
 *                   agentId: 3
 *                   agentName: "Agent Smith"
 *                   branch: "Main Branch"
 *                   status: "Pending"
 *                   notes: "Long-term investment for retirement planning"
 *                   rejectionReason: null
 *                   dateApplied: "2024-01-15T10:30:00.000Z"
 *                   merchantId: 1
 *                   packageId: 801
 *                   approvedBy: null
 *                   approvedAt: null
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *               pagination:
 *                 currentPage: 1
 *                 totalPages: 4
 *                 totalItems: 32
 *                 itemsPerPage: 10
 *       401:
 *         description: Unauthorized
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
 *   post:
 *     summary: Create a new investment application
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, targetAmount, duration]
 *             properties:
 *               customerName:
 *                 type: string
 *                 description: Customer full name
 *                 example: "John Doe"
 *               accountNumber:
 *                 type: string
 *                 description: Customer account number
 *                 example: "ACC123456"
 *               targetAmount:
 *                 type: number
 *                 format: float
 *                 description: Target investment amount
 *                 example: 100000
 *               duration:
 *                 type: integer
 *                 description: Investment duration in days
 *                 example: 180
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
 *                 example: "Customer interested in long-term investment"
 *     responses:
 *       201:
 *         description: Investment application created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Investment application created successfully"
 *               application:
 *                 id: 52
 *                 customerName: "Jane Doe"
 *                 accountNumber: "ACC123456"
 *                 targetAmount: 200000.00
 *                 duration: 180
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 status: "Pending"
 *                 notes: "Customer interested in long-term investment"
 *                 rejectionReason: null
 *                 dateApplied: "2024-01-15T10:30:00.000Z"
 *                 merchantId: 1
 *                 packageId: 801
 *                 approvedBy: null
 *                 approvedAt: null
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * /investment-applications/{id}:
 *   get:
 *     summary: Get investment application by ID
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Investment application ID
 *     responses:
 *       200:
 *         description: Investment application retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               application:
 *                 id: 51
 *                 customerName: "Jane Doe"
 *                 accountNumber: "ACC123456"
 *                 targetAmount: 150000.00
 *                 duration: 180
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 status: "Pending"
 *                 notes: "Long-term investment for retirement planning"
 *                 rejectionReason: null
 *                 dateApplied: "2024-01-15T10:30:00.000Z"
 *                 merchantId: 1
 *                 packageId: 801
 *                 approvedBy: null
 *                 approvedAt: null
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Investment application not found
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
 *     summary: Update investment application
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Investment application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetAmount:
 *                 type: number
 *                 format: float
 *                 description: Target investment amount
 *                 example: 100000
 *               duration:
 *                 type: integer
 *                 description: Investment duration in days
 *                 example: 180
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
 *                 example: "Updated investment requirements"
 *               status:
 *                 type: string
 *                 enum: [Pending, Approved, Rejected, Completed]
 *                 description: Application status
 *                 example: "Approved"
 *     responses:
 *       200:
 *         description: Investment application updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Investment application updated"
 *               application:
 *                 id: 51
 *                 targetAmount: 160000
 *                 status: "Approved"
 *       404:
 *         description: Investment application not found
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
 *     summary: Delete investment application
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Investment application ID
 *     responses:
 *       200:
 *         description: Investment application deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Investment application deleted successfully"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Investment application not found
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
 * /investment-applications/{id}/status:
 *   put:
 *     summary: Update investment application status
 *     tags: [Investment Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Investment application ID
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
 *             example:
 *               success: true
 *               message: "Application approved successfully"
 *               application:
 *                 id: 51
 *                 status: "Approved"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Investment application not found
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

// Update investment application (basic fields)
const updateInvestmentApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetAmount, duration, agentId, branch, notes, status } = req.body;
    const merchantId = req.user?.id || req.body.merchantId || 1;

    const application = await InvestmentApplication.findOne({ where: { id, merchantId } });
    if (!application) {
      return res.status(404).json({ success: false, message: 'Investment application not found' });
    }

    const updateData = {};
    if (targetAmount !== undefined) updateData.targetAmount = parseFloat(targetAmount);
    if (duration !== undefined) updateData.duration = parseInt(duration);
    if (agentId !== undefined) updateData.agentId = agentId;
    if (branch !== undefined) updateData.branch = branch;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;

    await application.update(updateData);

    return res.json({ success: true, message: 'Investment application updated', application });
  } catch (error) {
    console.error('Error updating investment application:', error);
    res.status(500).json({ success: false, message: 'Failed to update investment application', error: error.message });
  }
};

// Create a new investment application
const createInvestmentApplication = async (req, res) => {
  try {
    const { 
      customerName, 
      accountNumber, 
      targetAmount, 
      duration, 
      agentId, 
      branch, 
      notes 
    } = req.body;
    // Resolve merchantId from authenticated context
    let merchantId = req.body.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    // Find customer by accountNumber (preferred) or name, scoped to merchant
    const customerWhere = { merchantId };
    if (accountNumber) {
      customerWhere.accountNumber = accountNumber;
    } else if (customerName) {
      customerWhere.fullName = customerName;
    }
    const customer = await Customer.findOne({ where: customerWhere });

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

    const application = await InvestmentApplication.create({
      customerId: customer.id,
      customerName,
      accountNumber: accountNumber || customer.accountNumber,
      targetAmount: parseFloat(targetAmount),
      duration: parseInt(duration),
      agentId,
      agentName,
      branch,
      notes,
      merchantId,
      dateApplied: new Date()
    });

    // Fetch the created application with joined data
    const applicationWithJoins = await InvestmentApplication.findByPk(application.id, {
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

    // Transform the data to prioritize joined customer data
    const appData = applicationWithJoins.toJSON();
    // If we have joined customer data, use it instead of stored customerName
    if (appData.customer && appData.customer.fullName) {
      appData.customerName = appData.customer.fullName;
    }
    // If we have joined agent data, use it instead of stored agentName
    if (appData.agent && appData.agent.fullName) {
      appData.agentName = appData.agent.fullName;
    }

    res.status(201).json({
      success: true,
      message: 'Investment application created successfully',
      application: appData
    });
  } catch (error) {
    console.error('Error creating investment application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create investment application',
      error: error.message
    });
  }
};

// Get all investment applications for a merchant
const getInvestmentApplications = async (req, res) => {
  try {
    // Always scope to authenticated merchant
    // Resolve merchantId for both merchants and agents
    let merchantId;
    if (req.user?.type === 'merchant') {
      merchantId = req.user.id;
    } else if (req.user?.type === 'agent') {
      const agentOwner = await Agent.findByPk(req.user.id);
      merchantId = agentOwner ? agentOwner.merchantId : undefined;
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }
    const { 
      status, 
      search, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 10 
    } = req.query;

    const whereClause = { merchantId };
    
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
    
    const { count, rows: applications } = await InvestmentApplication.findAndCountAll({
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

    // Transform the data to prioritize joined customer data
    const transformedApplications = applications.map(app => {
      const appData = app.toJSON();
      // If we have joined customer data, use it instead of stored customerName
      if (appData.customer && appData.customer.fullName) {
        appData.customerName = appData.customer.fullName;
      }
      // If we have joined agent data, use it instead of stored agentName
      if (appData.agent && appData.agent.fullName) {
        appData.agentName = appData.agent.fullName;
      }
      return appData;
    });

    res.json({
      success: true,
      applications: transformedApplications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching investment applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investment applications',
      error: error.message
    });
  }
};

// Get investment application by ID
const getInvestmentApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    // Resolve merchantId for both merchants and agents
    let merchantId;
    if (req.user?.type === 'merchant') {
      merchantId = req.user.id;
    } else if (req.user?.type === 'agent') {
      const agentOwner = await Agent.findByPk(req.user.id);
      merchantId = agentOwner ? agentOwner.merchantId : undefined;
    }

    const application = await InvestmentApplication.findOne({
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
        message: 'Investment application not found'
      });
    }

    // Transform the data to prioritize joined customer data
    const appData = application.toJSON();
    // If we have joined customer data, use it instead of stored customerName
    if (appData.customer && appData.customer.fullName) {
      appData.customerName = appData.customer.fullName;
    }
    // If we have joined agent data, use it instead of stored agentName
    if (appData.agent && appData.agent.fullName) {
      appData.agentName = appData.agent.fullName;
    }

    res.json({
      success: true,
      application: appData
    });
  } catch (error) {
    console.error('Error fetching investment application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investment application',
      error: error.message
    });
  }
};

// Update investment application status
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, rejectionReason } = req.body;
    // Resolve merchantId for both merchants and agents
    let merchantId;
    if (req.user?.type === 'merchant') {
      merchantId = req.user.id;
    } else if (req.user?.type === 'agent') {
      const agentOwner = await Agent.findByPk(req.user.id);
      merchantId = agentOwner ? agentOwner.merchantId : undefined;
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }
    const staffId = req.user?.id || 1;

    let application = await InvestmentApplication.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!application) {
      // Fallback for legacy records created without proper merchant scoping
      application = await InvestmentApplication.findOne({ where: { id } });
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Investment application not found'
        });
      }
    }

    const updateData = { status };
    
    if (status === 'Approved') {
      // Only set approvedBy if the authenticated user is an actual Staff record
      try {
        if (staffId) {
          const staffRecord = await Staff.findByPk(staffId);
          if (staffRecord) {
            updateData.approvedBy = staffRecord.id;
          }
        }
      } catch {}
      updateData.approvedAt = new Date();
      // Clear any previous rejection reason on approval
      updateData.rejectionReason = null;
    } else if (status === 'Rejected') {
      updateData.rejectionReason = rejectionReason || null;
      // Clear approval fields on rejection
      updateData.approvedBy = null;
      updateData.approvedAt = null;
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

// Delete investment application
const deleteInvestmentApplication = async (req, res) => {
  try {
    const { id } = req.params;
    // Resolve merchantId for both merchants and agents
    let merchantId;
    if (req.user?.type === 'merchant') {
      merchantId = req.user.id;
    } else if (req.user?.type === 'agent') {
      const agentOwner = await Agent.findByPk(req.user.id);
      merchantId = agentOwner ? agentOwner.merchantId : undefined;
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    let application = await InvestmentApplication.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!application) {
      // Fallback for legacy records created without proper merchant scoping
      application = await InvestmentApplication.findOne({ where: { id } });
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Investment application not found'
        });
      }
    }

    await application.destroy();

    res.json({
      success: true,
      message: 'Investment application deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting investment application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete investment application',
      error: error.message
    });
  }
};

module.exports = {
  createInvestmentApplication,
  getInvestmentApplications,
  getInvestmentApplicationById,
  updateApplicationStatus,
  deleteInvestmentApplication,
  updateInvestmentApplication
};

