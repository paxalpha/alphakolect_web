const bcrypt = require('bcryptjs');
const { Agent, Branch, Merchant, Customer } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Agents
 *     description: Agent management
 * /agents:
 *   get:
 *     summary: List all agents
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Agents retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               agents:
 *                 - id: 12
 *                   name: "Agent One"
 *                   fullName: "Agent One"
 *                   phone: "+2348011111111"
 *                   phoneNumber: "+2348011111111"
 *                   branch: "Main Branch"
 *                   email: "agent1@example.com"
 *                   password: "$2b$10$hashedpasswordexample"
 *                   merchantId: 1
 *                   status: "active"
 *                   customersCount: 25
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *   post:
 *     summary: Register agent
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, phoneNumber, email, password, merchantId]
 *             properties:
 *               name: { type: string }
 *               fullName: { type: string }
 *               phoneNumber: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               branch: { type: string }
 *               merchantId: { type: integer }
 *     responses:
 *       201:
 *         description: Agent registered successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Agent registered successfully"
 *               agent:
 *                 id: 15
 *                 name: "New Agent"
 *                 fullName: "New Agent"
 *                 phone: "+2348022222222"
 *                 phoneNumber: "+2348022222222"
 *                 branch: "Main Branch"
 *                 email: "newagent@example.com"
 *                 password: "$2b$10$hashedpasswordexample"
 *                 merchantId: 1
 *                 status: "active"
 *                 customersCount: 0
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Email already registered
 *       404:
 *         description: Merchant not found
 *   put:
 *     summary: Update agent
 *     tags: [Agents]
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
 *               fullName: { type: string }
 *               phoneNumber: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               branch: { type: string }
 *               status: { type: string }
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Agent updated successfully"
 *               agent:
 *                 id: 12
 *                 name: "Agent One"
 *                 fullName: "Agent One"
 *                 phone: "+2348011111111"
 *                 phoneNumber: "+2348011111111"
 *                 branch: "Main Branch"
 *                 email: "agent1@example.com"
 *                 password: "$2b$10$hashedpasswordexample"
 *                 merchantId: 1
 *                 status: "active"
 *                 customersCount: 25
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Email already taken
 *       404:
 *         description: Agent not found
 * /agents/{id}:
 *   get:
 *     summary: Get agent by ID
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Agent retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               agent:
 *                 id: 12
 *                 name: "Agent One"
 *                 fullName: "Agent One"
 *                 phone: "+2348011111111"
 *                 phoneNumber: "+2348011111111"
 *                 branch: "Main Branch"
 *                 email: "agent1@example.com"
 *                 password: "$2b$10$hashedpasswordexample"
 *                 merchantId: 1
 *                 status: "active"
 *                 customersCount: 25
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Agent not found
 *
 * /agents/{id}/status:
 *   put:
 *     summary: Update agent status
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Agent ID
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
 *                 enum: [Active, Inactive, Suspended]
 *     responses:
 *       200:
 *         description: Agent status updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Agent status updated successfully"
 *               agent:
 *                 id: 12
 *                 name: "Agent One"
 *                 fullName: "Agent One"
 *                 phone: "+2348011111111"
 *                 phoneNumber: "+2348011111111"
 *                 branch: "Main Branch"
 *                 email: "agent1@example.com"
 *                 password: "$2b$10$hashedpasswordexample"
 *                 merchantId: 1
 *                 status: "Active"
 *                 customersCount: 25
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 */

// Register agent
const registerAgent = async (req, res) => {
  try {
    const { name, fullName, phoneNumber, email, password, branch, merchantId } = req.body;

    // Check if agent already exists
    const existingAgent = await Agent.findOne({ where: { email } });
    if (existingAgent) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Verify merchant exists
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create agent
    const agent = await Agent.create({
      name,
      fullName,
      phoneNumber,
      email,
      password: hashedPassword,
      branch,
      merchantId,
    });

    res.status(201).json({
      success: true,
      message: 'Agent registered successfully',
      agent: {
        id: agent.id,
        fullName: agent.fullName,
        email: agent.email,
        branch: agent.branch,
      },
    });
  } catch (error) {
    console.error('Agent registration error:', error);
    res.status(500).json({ message: 'Agent registration failed', error: error.message });
  }
};

// Update agent
const updateAgent = async (req, res) => {
  try {
    const { id, fullName, phoneNumber, email, password, branch, status } = req.body;

    const agent = await Agent.findByPk(id);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Check if email is being changed and if it's already taken
    if (email !== agent.email) {
      const existingAgent = await Agent.findOne({ where: { email } });
      if (existingAgent) {
        return res.status(400).json({ message: 'Email already taken' });
      }
    }

    // Hash password if provided
    let hashedPassword = agent.password;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Update agent
    await agent.update({
      fullName,
      phoneNumber,
      email,
      password: hashedPassword,
    });

    res.json({
      success: true,
      message: 'Agent updated successfully',
      agent: {
        id: agent.id,
        fullName: agent.fullName,
        email: agent.email,
        branch: agent.branch,
      },
    });
  } catch (error) {
    console.error('Agent update error:', error);
    res.status(500).json({ message: 'Agent update failed', error: error.message });
  }
};

// List all agents
const listAgents = async (req, res) => {
  try {
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
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

    const agents = await Agent.findAll({
      where: { merchantId },
      attributes: ['id', 'fullName', 'phoneNumber', 'email', 'branch', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      success: true,
      message: 'Agents retrieved successfully',
      agents,
    });
  } catch (error) {
    console.error('List agents error:', error);
    res.status(500).json({ message: 'Failed to retrieve agents', error: error.message });
  }
};

// Get agent by ID
const getAgentById = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await Agent.findByPk(id);

    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    res.json({
      success: true,
      message: 'Agent retrieved successfully',
      agent,
    });
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ message: 'Failed to retrieve agent', error: error.message });
  }
};

// Update agent status
const updateAgentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const agent = await Agent.findByPk(id);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Validate status
    const validStatuses = ['Active', 'Inactive', 'Suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be Active, Inactive, or Suspended' });
    }

    await agent.update({ status });

    res.json({
      message: 'Agent status updated successfully',
      agent: {
        id: agent.id,
        fullName: agent.fullName,
        status: agent.status,
      },
    });
  } catch (error) {
    console.error('Update agent status error:', error);
    res.status(500).json({ message: 'Failed to update agent status', error: error.message });
  }
};

// Update customer count for an agent
const updateCustomerCount = async (agentId) => {
  try {
    const customerCount = await Customer.count({
      where: { agentId }
    });

    await Agent.update(
      { customersCount: customerCount },
      { where: { id: agentId } }
    );

    return customerCount;
  } catch (error) {
    console.error('Error updating customer count:', error);
    return 0;
  }
};

module.exports = {
  registerAgent,
  updateAgent,
  listAgents,
  getAgentById,
  updateAgentStatus,
  updateCustomerCount,
};

