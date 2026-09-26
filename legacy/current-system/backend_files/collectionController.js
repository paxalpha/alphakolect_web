const { Collection, Customer, Agent, Package, Remittance } = require('../models');
const { Op, Sequelize } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Collections
 *     description: Collections management
 * /collections:
 *   get:
 *     summary: List collections
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Collections list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               collections:
 *                 - id: 101
 *                   customerId: 12
 *                   customerName: "John Doe"
 *                   accountNumber: "ACC123456"
 *                   amount: 5000.00
 *                   amountCollected: 5000.00
 *                   dueDate: "2025-01-31T00:00:00.000Z"
 *                   collectedDate: "2025-01-31T10:30:00.000Z"
 *                   type: "Daily"
 *                   description: "Daily savings collection"
 *                   collectionNotes: "Customer requested early collection"
 *                   priority: "Medium"
 *                   reminderSent: false
 *                   reminderDate: "2025-01-30T09:00:00.000Z"
 *                   packageId: 801
 *                   packageName: "Premium Package"
 *                   packageAmount: 50000.00
 *                   cycle: 30
 *                   cycleCounter: 5
 *                   isFirstCollection: false
 *                   status: "Pending"
 *                   merchantId: 1
 *                   agentId: 3
 *                   dateCreated: "2025-01-01T10:00:00.000Z"
 *   post:
 *     summary: Create single collection
 *     tags: [Single Collections]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, amount, dueDate, type]
 *             properties:
 *               customerName: { type: string }
 *               amount: { type: number, format: float }
 *               dueDate: { type: string, format: date }
 *               type: { type: string }
 *               description: { type: string }
 *               packageName: { type: string }
 *               packageAmount: { type: number, format: float }
 *               cycle: { type: integer }
 *               cycleCounter: { type: integer }
 *               isFirstCollection: { type: boolean }
 *     responses:
 *       201:
 *         description: Collection created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Collection created successfully"
 *               collection:
 *                 id: 102
 *                 customerId: 12
 *                 customerName: "John Doe"
 *                 accountNumber: "ACC123456"
 *                 amount: 5000.00
 *                 amountCollected: 0.00
 *                 dueDate: "2025-01-31T00:00:00.000Z"
 *                 collectedDate: null
 *                 type: "Daily"
 *                 description: "Daily savings collection"
 *                 collectionNotes: "Customer requested early collection"
 *                 priority: "Medium"
 *                 reminderSent: false
 *                 reminderDate: "2025-01-30T09:00:00.000Z"
 *                 packageId: 801
 *                 packageName: "Premium Package"
 *                 packageAmount: 50000.00
 *                 cycle: 30
 *                 cycleCounter: 5
 *                 isFirstCollection: false
 *                 status: "Pending"
 *                 merchantId: 1
 *                 agentId: 3
 *                 dateCreated: "2025-01-01T10:00:00.000Z"
 * /collections/bulk:
 *   post:
 *     summary: Create multiple collections in bulk
 *     tags: [Bulk Collections]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [collections]
 *             properties:
 *               collections:
 *                 type: array
 *                 description: List of collection payloads
 *                 items:
 *                   type: object
 *                   required: [customerName, amount, dueDate, type]
 *                   properties:
 *                     customerName: { type: string }
 *                     amount: { type: number, format: float }
 *                     dueDate: { type: string, format: date }
 *                     type: { type: string }
 *                     description: { type: string }
 *                     packageName: { type: string }
 *                     packageAmount: { type: number, format: float }
 *                     cycle: { type: integer }
 *                     cycleCounter: { type: integer }
 *                     isFirstCollection: { type: boolean }
 *     responses:
 *       201:
 *         description: Bulk collections created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               results:
 *                 - success: true
 *                   id: 201
 *                 - success: true
 *                   id: 202
 *       207:
 *         description: Bulk processed with partial failures
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               results:
 *                 - success: true
 *                   id: 203
 *                 - success: false
 *                   error: "Customer not found"
 *   put:
 *     summary: Update collection
 *     tags: [Collections]
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
 *               dueDate: { type: string, format: date }
 *               type: { type: string }
 *               status: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Collection updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Collection updated successfully"
 *               collection:
 *                 id: 101
 *                 status: "Collected"
 * /collections/{id}:
 *   get:
 *     summary: Get collection by ID
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Collection retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               collection:
 *                 id: 101
 *                 customerName: "John Doe"
 *                 amount: 5000
 *                 status: "Pending"
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Collection not found"
 *   delete:
 *     summary: Delete collection
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Collection deleted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Collection deleted successfully"
 * /collections/{id}/collect:
 *   put:
 *     summary: Mark collection as collected
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amountCollected: { type: number, format: float }
 *               collectionNotes: { type: string }
 *     responses:
 *       200:
 *         description: Collection marked as collected
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Collection marked as collected"
 *               collection:
 *                 id: 101
 *                 status: "Collected"
 * /collections/status/{status}:
 *   get:
 *     summary: Get collections by status
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: status
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Collections by status
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               collections:
 *                 - id: 101
 *                   status: "Pending"
 * /collections/overdue:
 *   get:
 *     summary: Get overdue collections
 *     tags: [Collections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overdue collections
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               collections:
 *                 - id: 99
 *                   dueDate: "2024-12-15T00:00:00.000Z"
 *                   status: "Pending"
 */

// Create a new collection
const createCollection = async (req, res) => {
  try {
    const { 
      customerName, 
      amount, 
      dueDate, 
      type, 
      description,
      packageName,
      packageAmount,
      cycle,
      cycleCounter,
      isFirstCollection
    } = req.body;
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
    
    // Find package by name to get its ID
    let packageId = null;
    if (packageName) {
      const pkg = await Package.findOne({ 
        where: { 
          name: packageName,
          merchantId: merchantId,
          status: { [Op.ne]: 'Deleted' }
        } 
      });
      if (pkg) {
        packageId = pkg.id;
      }
    }

    const collection = await Collection.create({
      customerId: customer.id,
      customerName,
      amount: parseFloat(amount),
      dueDate: new Date(dueDate),
      type,
      description: description || '',
      packageName: packageName || '',
      packageId: packageId,
      packageAmount: packageAmount ? parseFloat(packageAmount) : null,
      cycle: cycle ? parseInt(cycle) : 31,
      cycleCounter: cycleCounter ? parseInt(cycleCounter) : 1,
      isFirstCollection: isFirstCollection === 'true' || isFirstCollection === true,
      status: 'Pending',
      merchantId,
      dateCreated: new Date()
    });

    // Update customer's packgeId if not set
    if (!customer.packageId && packageId) {
        await customer.update({ packageId: packageId });
    }

    // Automatically place in a Remittance holding state per workflow rules
    try {
      await Remittance.create({
        collectionId: collection.id,
        customerId: customer.id,
        customerName: customer.fullName,
        accountNumber: customer.accountNumber || null,
        amount: parseFloat(amount),
        agentId: customer.agentId || null,
        merchantId,
        status: 'Pending',
        notes: `Auto-created alongside Collection #${collection.id}`
      });
    } catch (remitError) {
      console.error('Failed to auto-create holding Remittance:', remitError);
    }

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      collection
    });
  } catch (error) {
    console.error('Error creating collection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create collection',
      error: error.message
    });
  }
};

// Get all collections for a merchant
const getCollections = async (req, res) => {
  try {
    const merchantId = req.user.id;

    const collections = await Collection.findAll({
      where: { merchantId },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber', 'accountNumber', 'agentId'],
          include: [
            {
              model: Agent,
              as: 'Agent',
              attributes: ['id', 'fullName', 'branch']
            }
          ]
        }
      ],
      // Ensure unique rows when using JOINs
      distinct: true,
      subQuery: false,
      // Order by physical column to avoid createdAt mapping issues
      order: [[Sequelize.col('date_created'), 'DESC']]
    });

    // Normalize response to include top-level accountNumber and packageName for frontend
    const normalized = collections.map((c) => {
      const json = c.toJSON();
      json.accountNumber = json?.customer?.accountNumber || null;
      json.packageName = json?.packageName || null;
      return json;
    });

    res.json({
      success: true,
      collections: normalized
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collections',
      error: error.message
    });
  }
};

// Get collection by ID
const getCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const collection = await Collection.findOne({
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

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    res.json({
      success: true,
      collection
    });
  } catch (error) {
    console.error('Error fetching collection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collection',
      error: error.message
    });
  }
};

// Update collection
const updateCollection = async (req, res) => {
  try {
    const { id, customerName, amount, dueDate, type, status, description } = req.body;
    const merchantId = req.user.id;

    const collection = await Collection.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    await collection.update({
      customerName: customerName || collection.customerName,
      amount: amount ? parseFloat(amount) : collection.amount,
      dueDate: dueDate ? new Date(dueDate) : collection.dueDate,
      type: type || collection.type,
      status: status || collection.status,
      description: description !== undefined ? description : collection.description,
      collectedDate: status === 'Collected' ? new Date() : collection.collectedDate
    });

    // If marked as Collected, create a Remittance record
    if (status === 'Collected') {
      try {
        // Check if remittance already exists for this collection to avoid duplicates
        const existingRemittance = await Remittance.findOne({
          where: { collectionId: collection.id }
        });

        if (!existingRemittance) {
          // Fetch customer to get agent details for the remittance
          const customer = await Customer.findByPk(collection.customerId);
          
          await Remittance.create({
            collectionId: collection.id,
            customerId: collection.customerId,
            customerName: collection.customerName,
            accountNumber: collection.accountNumber || (customer ? customer.accountNumber : null),
            amount: collection.amount,
            agentId: customer ? customer.agentId : null,
            merchantId: merchantId,
            status: 'Pending',
            notes: `Auto-created from Collection #${collection.id}`
          });
          console.log(`Auto-created remittance for collection #${collection.id}`);
        }
      } catch (remitError) {
        console.error('Failed to auto-create remittance:', remitError);
        // We don't fail the whole request just because remittance creation failed, 
        // but we log it for debugging.
      }
    }

    res.json({
      success: true,
      message: 'Collection updated successfully',
      collection
    });
  } catch (error) {
    console.error('Error updating collection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update collection',
      error: error.message
    });
  }
};

// Mark collection as collected
const markAsCollected = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountCollected, collectionNotes } = req.body;
    const merchantId = req.user.id;

    const collection = await Collection.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    await collection.update({
      status: 'Collected',
      collectedDate: new Date(),
      amountCollected: amountCollected ? parseFloat(amountCollected) : collection.amount,
      collectionNotes: collectionNotes || ''
    });

    // Create a Remittance record
    try {
      const existingRemittance = await Remittance.findOne({
        where: { collectionId: collection.id }
      });

      if (!existingRemittance) {
        const customer = await Customer.findByPk(collection.customerId);
        await Remittance.create({
          collectionId: collection.id,
          customerId: collection.customerId,
          customerName: collection.customerName,
          accountNumber: collection.accountNumber || (customer ? customer.accountNumber : null),
          amount: parseFloat(amountCollected || collection.amount),
          agentId: customer ? customer.agentId : null,
          merchantId: merchantId,
          status: 'Pending',
          notes: collectionNotes || `Auto-created from Collection #${collection.id}`
        });
      }
    } catch (remitError) {
      console.error('Failed to auto-create remittance in markAsCollected:', remitError);
    }

    res.json({
      success: true,
      message: 'Collection marked as collected',
      collection
    });
  } catch (error) {
    console.error('Error marking collection as collected:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark collection as collected',
      error: error.message
    });
  }
};

// Delete collection (soft delete)
const deleteCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const collection = await Collection.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    await collection.update({ status: 'Deleted' });

    res.json({
      success: true,
      message: 'Collection deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete collection',
      error: error.message
    });
  }
};

// Create multiple collections in bulk
const createCollectionsBulk = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const payload = req.body && Array.isArray(req.body.collections) ? req.body.collections : [];
    if (!Array.isArray(payload) || payload.length === 0) {
      return res.status(400).json({ success: false, message: 'collections array is required' });
    }

    const results = [];
    for (const item of payload) {
      try {
        const { customerName, amount, dueDate, type, description, packageName, packageAmount, cycle, cycleCounter, isFirstCollection } = item || {};
        if (!customerName || amount === undefined || !dueDate || !type) {
          throw new Error('Missing required fields');
        }

        const customer = await Customer.findOne({ where: { fullName: customerName, merchantId } });
        if (!customer) throw new Error('Customer not found');

        // Find package by name to get its ID
        let packageId = null;
        if (packageName) {
          const pkg = await Package.findOne({ 
            where: { 
              name: packageName,
              merchantId: merchantId,
              status: { [Op.ne]: 'Deleted' }
            } 
          });
          if (pkg) {
            packageId = pkg.id;
          }
        }

        const created = await Collection.create({
          customerId: customer.id,
          customerName,
          amount: parseFloat(amount),
          dueDate: new Date(dueDate),
          type,
          description: description || '',
          packageName: packageName || '',
          packageId: packageId,
          packageAmount: packageAmount ? parseFloat(packageAmount) : null,
          cycle: cycle ? parseInt(cycle) : 31,
          cycleCounter: cycleCounter ? parseInt(cycleCounter) : 1,
          isFirstCollection: isFirstCollection === 'true' || isFirstCollection === true,
          status: 'Pending',
          merchantId,
          dateCreated: new Date()
        });

        // Update customer's packgeId if not set
        if (!customer.packageId && packageId) {
            await customer.update({ packageId: packageId });
        }

        // Automatically place in a Remittance holding state per workflow rules
        try {
          await Remittance.create({
            collectionId: created.id,
            customerId: customer.id,
            customerName: customer.fullName,
            accountNumber: customer.accountNumber || null,
            amount: parseFloat(amount),
            agentId: customer.agentId || null,
            merchantId,
            status: 'Pending',
            notes: `Auto-created alongside Bulk Collection #${created.id}`
          });
        } catch (remitError) {
          console.error('Failed to auto-create holding Remittance (Bulk):', remitError);
        }
        results.push({ success: true, id: created.id });
      } catch (err) {
        results.push({ success: false, error: err.message || String(err) });
      }
    }

    const hasFailures = results.some(r => !r.success);
    return res.status(hasFailures ? 207 : 201).json({ success: !hasFailures, results });
  } catch (error) {
    console.error('Error creating bulk collections:', error);
    res.status(500).json({ success: false, message: 'Failed to create bulk collections', error: error.message });
  }
};

// Get collections by status
const getCollectionsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const merchantId = req.user.id;

    const collections = await Collection.findAll({
      where: { 
        merchantId,
        status
      },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ],
      order: [['dueDate', 'ASC']]
    });

    res.json({
      success: true,
      collections
    });
  } catch (error) {
    console.error('Error fetching collections by status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collections by status',
      error: error.message
    });
  }
};

// Get overdue collections
const getOverdueCollections = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const today = new Date();

    const collections = await Collection.findAll({
      where: { 
        merchantId,
        status: 'Pending',
        dueDate: {
          [Op.lt]: today
        }
      },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ],
      order: [['dueDate', 'ASC']]
    });

    res.json({
      success: true,
      collections
    });
  } catch (error) {
    console.error('Error fetching overdue collections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue collections',
      error: error.message
    });
  }
};

module.exports = {
  createCollection,
  createCollectionsBulk,
  // Note: bulk endpoint handled by createCollectionsBulk below
  getCollections,
  getCollectionById,
  updateCollection,
  markAsCollected,
  deleteCollection,
  getCollectionsByStatus,
  getOverdueCollections
};

