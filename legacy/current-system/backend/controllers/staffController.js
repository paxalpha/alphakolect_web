const bcrypt = require('bcryptjs');
const { Staff, Role, Branch, Merchant } = require('../models');


/**
 * @swagger
 * tags:
 *   - name: Staff
 *     description: Staff management
 * /staff:
 *   get:
 *     summary: List all staff
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Staff retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Staff retrieved successfully"
 *               staff:
 *                 - id: 5
 *                   fullName: "Alice Smith"
 *                   email: "alice@example.com"
 *                   phoneNumber: "+2348011111111"
 *   post:
 *     summary: Create staff
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phoneNumber, roleId, merchantId]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               phoneNumber: { type: string }
 *               branch: { type: string }
 *               role: { type: string }
 *               merchantId: { type: integer }
 *               roleId: { type: integer }
 *     responses:
 *       201:
 *         description: Staff created successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Staff created successfully"
 *               staff:
 *                 id: 6
 *                 fullName: "Bob Jones"
 *                 email: "bob@example.com"
 *                 phoneNumber: "+2348022222222"
 *       400:
 *         description: Email already registered
 *       404:
 *         description: Role or Merchant not found
 * /staff/{id}:
 *   get:
 *     summary: Get staff by ID
 *     tags: [Staff]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Staff ID
 *     responses:
 *       200:
 *         description: Staff retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Staff retrieved successfully"
 *               staff:
 *                 id: 5
 *                 fullName: "Alice Smith"
 *                 email: "alice@example.com"
 *       404:
 *         description: Staff not found
 *   put:
 *     summary: Update staff
 *     tags: [Staff]
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
 *               email: { type: string, format: email }
 *               phoneNumber: { type: string }
 *               branch: { type: string }
 *               role: { type: string }
 *               roleId: { type: integer }
 *     responses:
 *       200:
 *         description: Staff updated successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Staff updated successfully"
 *               staff:
 *                 id: 5
 *                 fullName: "Alice Smith"
 *                 email: "alice@example.com"
 */

// Create staff
const createStaff = async (req, res) => {
  try {
    const { fullName, email, phoneNumber, branch, role, merchantId, roleId, password } = req.body;

    const resolvedMerchantId = merchantId
      ? parseInt(merchantId)
      : (req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null));

    if (!resolvedMerchantId) {
      return res.status(400).json({ message: 'merchantId is required' });
    }

    // Check if staff already exists
    const existingStaff = await Staff.findOne({ where: { email } });
    if (existingStaff) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Resolve roleId & role name
    let finalRoleId = roleId ? parseInt(roleId) : (role && !isNaN(Number(role)) ? parseInt(role) : null);
    let finalRoleName = typeof role === 'string' && isNaN(Number(role)) ? role : '';

    if (finalRoleId) {
      const staffRole = await Role.findByPk(finalRoleId);
      if (staffRole) {
        finalRoleName = staffRole.roleName || staffRole.name || finalRoleName;
      }
    } else if (finalRoleName) {
      const staffRole = await Role.findOne({ where: { roleName: finalRoleName } });
      if (staffRole) {
        finalRoleId = staffRole.id;
      }
    }

    // Hash password (use provided password or default 'Staff123!')
    const plainPassword = password && String(password).trim().length > 0 ? String(password).trim() : 'Staff123!';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const staff = await Staff.create({
      fullName,
      email,
      phoneNumber,
      branch: branch || 'Main',
      role: finalRoleName || 'Staff',
      merchantId: resolvedMerchantId,
      roleId: finalRoleId,
      password: hashedPassword,
    });

    res.status(201).json({
      message: 'Staff created successfully',
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        email: staff.email,
        phoneNumber: staff.phoneNumber,
        branch: staff.branch,
        role: staff.role,
        roleId: staff.roleId,
      },
    });
  } catch (error) {
    console.error('Staff creation error:', error);
    res.status(500).json({ message: 'Staff creation failed', error: error.message });
  }
};

// Update staff
const updateStaff = async (req, res) => {
  try {
    const { id, fullName, email, phoneNumber, branch, role, roleId, status, password } = req.body;

    const staff = await Staff.findByPk(id);
    if (!staff) {
      return res.status(404).json({ message: 'Staff not found' });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== staff.email) {
      const existingStaff = await Staff.findOne({ where: { email } });
      if (existingStaff) {
        return res.status(400).json({ message: 'Email already taken' });
      }
    }

    // Verify role exists if provided
    if (roleId) {
      const staffRole = await Role.findByPk(roleId);
      if (!staffRole) {
        return res.status(404).json({ message: 'Role not found' });
      }
    }

    const updateFields = {};
    if (fullName) updateFields.fullName = fullName;
    if (email) updateFields.email = email;
    if (phoneNumber) updateFields.phoneNumber = phoneNumber;
    if (branch) updateFields.branch = branch;
    if (role) updateFields.role = role;
    if (roleId) updateFields.roleId = roleId;
    if (status) updateFields.status = status;
    if (password && String(password).trim().length > 0) {
      updateFields.password = await bcrypt.hash(String(password).trim(), 10);
    }

    await staff.update(updateFields);


    res.json({
      message: 'Staff updated successfully',
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        email: staff.email,
        phoneNumber: staff.phoneNumber,
        branch: staff.branch,
        role: staff.role,
      },
    });
  } catch (error) {
    console.error('Staff update error:', error);
    res.status(500).json({ message: 'Staff update failed', error: error.message });
  }
};

// List all staff
const listStaff = async (req, res) => {
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

    const staff = await Staff.findAll({
      where: { merchantId },
      attributes: ['id', 'fullName', 'email', 'phoneNumber', 'branch', 'role', 'status', 'createdAt'],
      include: [
        {
          model: Role,
          as: 'Role',
          attributes: ['id', 'roleName'],
        },
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      message: 'Staff retrieved successfully',
      staff,
    });
  } catch (error) {
    console.error('List staff error:', error);
    res.status(500).json({ message: 'Failed to retrieve staff', error: error.message });
  }
};

// Get staff by ID
const getStaffById = async (req, res) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findByPk(id, {
      include: [
        {
          model: Role,
          as: 'Role',
          attributes: ['id', 'roleName'],
        },
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName'],
        },
      ],
    });

    if (!staff) {
      return res.status(404).json({ message: 'Staff not found' });
    }

    res.json({
      message: 'Staff retrieved successfully',
      staff,
    });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ message: 'Failed to retrieve staff', error: error.message });
  }
};

module.exports = {
  createStaff,
  updateStaff,
  listStaff,
  getStaffById,
};
