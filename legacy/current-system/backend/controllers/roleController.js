const { Role } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Roles
 *     description: Role management
 * /roles:
 *   get:
 *     summary: List all roles for authenticated merchant
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
 *   post:
 *     summary: Create role for merchant
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 * /roles/{id}:
 *   get:
 *     summary: Get role by ID
 *     tags: [Roles]
 *   put:
 *     summary: Update role
 *     tags: [Roles]
 */

// Create role
const createRole = async (req, res) => {
  try {
    const { roleName, cantView, canViewOnly, canEdit, permissions } = req.body;
    const merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);

    if (!merchantId) {
      return res.status(400).json({ message: 'merchantId is required' });
    }

    // Check if role already exists for this merchant
    const existingRole = await Role.findOne({ where: { roleName, merchantId } });
    if (existingRole) {
      return res.status(400).json({ message: 'Role name already exists' });
    }

    // Create role
    const role = await Role.create({
      merchantId,
      roleName,
      cantView,
      canViewOnly,
      canEdit,
      permissions,
    });

    res.status(201).json({
      message: 'Role created successfully',
      role: {
        id: role.id,
        merchantId: role.merchantId,
        roleName: role.roleName,
        cantView: role.cantView,
        canViewOnly: role.canViewOnly,
        canEdit: role.canEdit,
        permissions: role.permissions,
      },
    });
  } catch (error) {
    console.error('Role creation error:', error);
    res.status(500).json({ message: 'Role creation failed', error: error.message });
  }
};

// Update role
const updateRole = async (req, res) => {
  try {
    const { id, roleName, cantView, canViewOnly, canEdit, permissions } = req.body;
    const merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);

    const role = await Role.findByPk(id);
    if (!role || (merchantId && role.merchantId && role.merchantId !== merchantId)) {
      return res.status(404).json({ message: 'Role not found' });
    }

    // Check if name is being changed and if it's already taken for this merchant
    if (roleName !== role.roleName) {
      const existingRole = await Role.findOne({ where: { roleName, merchantId } });
      if (existingRole) {
        return res.status(400).json({ message: 'Role name already taken' });
      }
    }

    // Update role
    await role.update({
      roleName,
      cantView,
      canViewOnly,
      canEdit,
      permissions,
    });

    res.json({
      message: 'Role updated successfully',
      role: {
        id: role.id,
        merchantId: role.merchantId,
        roleName: role.roleName,
        cantView: role.cantView,
        canViewOnly: role.canViewOnly,
        canEdit: role.canEdit,
        permissions: role.permissions,
      },
    });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ message: 'Role update failed', error: error.message });
  }
};

// List all roles for the authenticated merchant
const listRoles = async (req, res) => {
  try {
    const merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);
    
    // Scoped strictly to the requesting merchant
    const whereClause = merchantId ? { merchantId } : {};

    const roles = await Role.findAll({
      where: whereClause,
      attributes: ['id', 'merchantId', 'roleName', 'cantView', 'canViewOnly', 'canEdit', 'permissions', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      message: 'Roles retrieved successfully',
      roles,
    });
  } catch (error) {
    console.error('List roles error:', error);
    res.status(500).json({ message: 'Failed to retrieve roles', error: error.message });
  }
};

// Get role by ID
const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);

    const role = await Role.findByPk(id);

    if (!role || (merchantId && role.merchantId && role.merchantId !== merchantId)) {
      return res.status(404).json({ message: 'Role not found' });
    }

    res.json({
      message: 'Role retrieved successfully',
      role,
    });
  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({ message: 'Failed to retrieve role', error: error.message });
  }
};

module.exports = {
  createRole,
  updateRole,
  listRoles,
  getRoleById,
};
