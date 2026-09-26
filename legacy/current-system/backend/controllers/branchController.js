const { Branch, Merchant } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Branches
 *     description: Branch management
 * /branches:
 *   get:
 *     summary: List all branches
 *     tags: [Branches]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Branches retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Branches retrieved successfully"
 *               branches:
 *                 - id: 1
 *                   name: "Main Branch"
 *                   state: "Lagos"
 *                   location: "Ikeja"
 *                 - id: 2
 *                   name: "Abuja Branch"
 *                   state: "FCT"
 *                   location: "Central Area"
 *   post:
 *     summary: Create branch
 *     tags: [Branches]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, state, location, merchantId]
 *             properties:
 *               name: { type: string }
 *               state: { type: string }
 *               location: { type: string }
 *               merchantId: { type: integer }
 *     responses:
 *       201:
 *         description: Branch created successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Branch created successfully"
 *               branch:
 *                 id: 10
 *                 name: "Yaba Branch"
 *                 state: "Lagos"
 *                 location: "Yaba"
 *       400:
 *         description: Branch name already exists
 *       404:
 *         description: Merchant not found
 * /branches/{id}:
 *   get:
 *     summary: Get branch by ID
 *     tags: [Branches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Branch retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Branch retrieved successfully"
 *               branch:
 *                 id: 1
 *                 name: "Main Branch"
 *                 state: "Lagos"
 *                 location: "Ikeja"
 *       404:
 *         description: Branch not found
 *   delete:
 *     summary: Delete branch
 *     tags: [Branches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Branch deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Branch deleted successfully"
 *
 */

// Create branch
const createBranch = async (req, res) => {
  try {
    const { name, state, location, merchantId } = req.body;

    // Check if branch already exists
    const existingBranch = await Branch.findOne({ where: { name } });
    if (existingBranch) {
      return res.status(400).json({ message: 'Branch name already exists' });
    }

    // Verify merchant exists
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    // Create branch
    const branch = await Branch.create({
      name,
      state,
      location,
      merchantId,
    });

    res.status(201).json({
      message: 'Branch created successfully',
      branch: {
        id: branch.id,
        name: branch.name,
        state: branch.state,
        location: branch.location,
      },
    });
  } catch (error) {
    console.error('Branch creation error:', error);
    res.status(500).json({ message: 'Branch creation failed', error: error.message });
  }
};

// Update branch
const updateBranch = async (req, res) => {
  try {
    const { id, name, state, location } = req.body;

    const branch = await Branch.findByPk(id);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Check if name is being changed and if it's already taken
    if (name !== branch.name) {
      const existingBranch = await Branch.findOne({ where: { name } });
      if (existingBranch) {
        return res.status(400).json({ message: 'Branch name already taken' });
      }
    }

    // Update branch
    await branch.update({
      name,
      state,
      location,
    });

    res.json({
      message: 'Branch updated successfully',
      branch: {
        id: branch.id,
        name: branch.name,
        state: branch.state,
        location: branch.location,
      },
    });
  } catch (error) {
    console.error('Branch update error:', error);
    res.status(500).json({ message: 'Branch update failed', error: error.message });
  }
};

// List all branches
const listBranches = async (req, res) => {
  try {
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
      } else if (req.user?.type === 'agent') {
        const { Agent } = require('../models');
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    const branches = await Branch.findAll({
      where: { merchantId },
      attributes: ['id', 'name', 'state', 'location', 'createdAt'],
      include: [
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      message: 'Branches retrieved successfully',
      branches,
    });
  } catch (error) {
    console.error('List branches error:', error);
    res.status(500).json({ message: 'Failed to retrieve branches', error: error.message });
  }
};

// Get branch by ID
const getBranchById = async (req, res) => {
  try {
    const { id } = req.params;

    const branch = await Branch.findByPk(id, {
      include: [
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName'],
        },
      ],
    });

    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    res.json({
      message: 'Branch retrieved successfully',
      branch,
    });
  } catch (error) {
    console.error('Get branch error:', error);
    res.status(500).json({ message: 'Failed to retrieve branch', error: error.message });
  }
};

// Delete branch
const deleteBranch = async (req, res) => {
  return res.status(400).json({ message: 'Deleting branches is disabled to avoid orphaned records.' });
};

module.exports = {
  createBranch,
  updateBranch,
  listBranches,
  getBranchById,
  deleteBranch,
};
