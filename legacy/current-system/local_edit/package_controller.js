const { Package, Customer, Collection } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Packages
 *     description: Package management
 * /packages:
 *   get:
 *     summary: List packages
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Packages list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               packages:
 *                 - id: 801
 *                   name: "Premium Savings Package"
 *                   type: "Savings"
 *                   amount: 100000.00
 *                   seedAmount: 10000.00
 *                   seedType: "Fixed"
 *                   period: 30
 *                   collectionDays: "Daily"
 *                   duration: 365
 *                   benefits: ["High interest rate", "Flexible withdrawal", "Bonus rewards"]
 *                   description: "Premium savings package with high returns"
 *                   status: "Active"
 *                   interestRate: 12.5
 *                   extraCharges: 500.00
 *                   defaultPenalty: 1000.00
 *                   defaultDays: 7
 *                   loanAmount: 500000.00
 *                   loanInterestRate: 15.0
 *                   loanPeriod: 12
 *                   defaultAmount: 5000.00
 *                   gracePeriod: 30
 *                   loanCharges: 2500.00
 *                   packageCategory: "Premium"
 *                   maxCustomers: 100
 *                   currentCustomers: 25
 *                   minimumSavings: 1000.00
 *                   savingsFrequency: "Daily"
 *                   merchantId: 1
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *   post:
 *     summary: Create package
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Package'
 *     responses:
 *       201:
 *         description: Package created
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Package created successfully"
 *               package:
 *                 id: 801
 *                 name: "Premium Savings Package"
 *                 type: "Savings"
 *                 amount: 100000.00
 *                 seedAmount: 10000.00
 *                 seedType: "Fixed"
 *                 period: 30
 *                 collectionDays: "Daily"
 *                 duration: 365
 *                 benefits: ["High interest rate", "Flexible withdrawal", "Bonus rewards"]
 *                 description: "Premium savings package with high returns"
 *                 status: "Active"
 *                 interestRate: 12.5
 *                 extraCharges: 500.00
 *                 defaultPenalty: 1000.00
 *                 defaultDays: 7
 *                 loanAmount: 500000.00
 *                 loanInterestRate: 15.0
 *                 loanPeriod: 12
 *                 defaultAmount: 5000.00
 *                 gracePeriod: 30
 *                 loanCharges: 2500.00
 *                 packageCategory: "Premium"
 *                 maxCustomers: 100
 *                 currentCustomers: 0
 *                 minimumSavings: 1000.00
 *                 savingsFrequency: "Daily"
 *                 merchantId: 1
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 * /packages/active:
 *   get:
 *     summary: List active packages
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Active packages list
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               packages:
 *                 - id: 801
 *                   name: "Premium Savings Package"
 *                   type: "Savings"
 *                   amount: 100000.00
 *                   seedAmount: 10000.00
 *                   seedType: "Fixed"
 *                   period: 30
 *                   collectionDays: "Daily"
 *                   duration: 365
 *                   benefits: ["High interest rate", "Flexible withdrawal", "Bonus rewards"]
 *                   description: "Premium savings package with high returns"
 *                   status: "Active"
 *                   interestRate: 12.5
 *                   extraCharges: 500.00
 *                   defaultPenalty: 1000.00
 *                   defaultDays: 7
 *                   loanAmount: 500000.00
 *                   loanInterestRate: 15.0
 *                   loanPeriod: 12
 *                   defaultAmount: 5000.00
 *                   gracePeriod: 30
 *                   loanCharges: 2500.00
 *                   packageCategory: "Premium"
 *                   maxCustomers: 100
 *                   currentCustomers: 25
 *                   minimumSavings: 1000.00
 *                   savingsFrequency: "Daily"
 *                   merchantId: 1
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 * /packages/{id}:
 *   get:
 *     summary: Get package by ID
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Package retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               package:
 *                 id: 801
 *                 name: "Premium Savings Package"
 *                 type: "Savings"
 *                 amount: 100000.00
 *                 seedAmount: 10000.00
 *                 seedType: "Fixed"
 *                 period: 30
 *                 collectionDays: "Daily"
 *                 duration: 365
 *                 benefits: ["High interest rate", "Flexible withdrawal", "Bonus rewards"]
 *                 description: "Premium savings package with high returns"
 *                 status: "Active"
 *                 interestRate: 12.5
 *                 extraCharges: 500.00
 *                 defaultPenalty: 1000.00
 *                 defaultDays: 7
 *                 loanAmount: 500000.00
 *                 loanInterestRate: 15.0
 *                 loanPeriod: 12
 *                 defaultAmount: 5000.00
 *                 gracePeriod: 30
 *                 loanCharges: 2500.00
 *                 packageCategory: "Premium"
 *                 maxCustomers: 100
 *                 currentCustomers: 25
 *                 minimumSavings: 1000.00
 *                 savingsFrequency: "Daily"
 *                 merchantId: 1
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Not found
 *   delete:
 *     summary: Delete package
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Package deleted
 *   put:
 *     summary: Update package
 *     tags: [Packages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Package'
 *     responses:
 *       200:
 *         description: Package updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Package updated successfully"
 *               package:
 *                 id: 801
 *                 name: "Premium Savings Package"
 *                 type: "Savings"
 *                 amount: 100000.00
 *                 seedAmount: 10000.00
 *                 seedType: "Fixed"
 *                 period: 30
 *                 collectionDays: "Daily"
 *                 duration: 365
 *                 benefits: ["High interest rate", "Flexible withdrawal", "Bonus rewards"]
 *                 description: "Premium savings package with high returns"
 *                 status: "Active"
 *                 interestRate: 12.5
 *                 extraCharges: 500.00
 *                 defaultPenalty: 1000.00
 *                 defaultDays: 7
 *                 loanAmount: 500000.00
 *                 loanInterestRate: 15.0
 *                 loanPeriod: 12
 *                 defaultAmount: 5000.00
 *                 gracePeriod: 30
 *                 loanCharges: 2500.00
 *                 packageCategory: "Premium"
 *                 maxCustomers: 100
 *                 currentCustomers: 25
 *                 minimumSavings: 1000.00
 *                 savingsFrequency: "Daily"
 *                 merchantId: 1
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 */

// Helper to resolve merchantId for both merchants and agents
function resolveMerchantId(req) {
  try {
    if (req.user && req.user.merchantId) {
      return parseInt(req.user.merchantId, 10);
    }
    if (req.user && req.user.type === 'merchant') {
      return parseInt(req.user.id, 10);
    }
    const fallback = req.query?.merchantId || req.body?.merchantId;
    if (fallback) return parseInt(fallback, 10);
  } catch (_) {}
  return null;
}

// Create a new package
const createPackage = async (req, res) => {
  try {
    const { 
      name, 
      type, 
      amount, 
      seedAmount, 
      seedType, 
      period, 
      collectionDays, 
      duration, 
      benefits, 
      description,
      interestRate,
      extraCharges,
      defaultPenalty,
      defaultDays,
      defaultPercentageRate,
      // Loan-specific fields
      loanAmount,
      loanInterestRate,
      interestAmount,
      loanPeriod,
      defaultAmount,
      gracePeriod,
      loanCharges,
      packageCategory
    } = req.body;
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, message: 'Missing merchantId', error: 'merchantId is required' });
    }

    // Check for double creation
    const existingPackage = await Package.findOne({
      where: {
        name,
        merchantId,
        status: { [Op.ne]: 'Deleted' }
      }
    });

    if (existingPackage) {
      return res.status(400).json({ 
        success: false, 
        message: 'A package with this name already exists for this merchant.' 
      });
    }

    const packageData = await Package.create({
      name,
      type: type || 'Fixed',
      amount: parseFloat(amount),
      seedAmount: seedAmount ? parseFloat(seedAmount) : parseFloat(amount),
      seedType: seedType || 'First saving',
      period: parseInt(period) || parseInt(duration) || 360,
      collectionDays: collectionDays || 'Daily',
      duration: parseInt(duration),
      benefits: Array.isArray(benefits) ? benefits : [benefits],
      description: description || '',
      status: 'Active',
      merchantId,
      dateCreated: new Date(),
      interestRate: interestRate ? parseFloat(interestRate) : null,
      extraCharges: extraCharges ? parseFloat(extraCharges) : 0.00,
      defaultPenalty: defaultPenalty ? parseFloat(defaultPenalty) : 0.00,
      defaultDays: defaultDays ? parseInt(defaultDays) : 0,
      defaultPercentageRate: defaultPercentageRate ? parseFloat(defaultPercentageRate) : null,
      // Loan-specific fields
      loanAmount: loanAmount ? parseFloat(loanAmount) : null,
      loanInterestRate: loanInterestRate ? parseFloat(loanInterestRate) : null,
      interestAmount: interestAmount ? parseFloat(interestAmount) : null,
      loanPeriod: loanPeriod ? parseInt(loanPeriod) : null,
      defaultAmount: defaultAmount ? parseFloat(defaultAmount) : 0.00,
      gracePeriod: gracePeriod ? parseInt(gracePeriod) : 0,
      loanCharges: loanCharges ? parseFloat(loanCharges) : 0.00,
      packageCategory: packageCategory || 'Investment'
    });

    res.status(201).json({
      success: true,
      message: 'Package created successfully',
      package: packageData
    });
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create package',
      error: error.message
    });
  }
};

// Get all packages for a merchant
const getPackages = async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, message: 'Missing merchantId', error: 'merchantId is required' });
    }
    const { category, type, status } = req.query;

    let whereClause = { 
      merchantId,
      status: { [Op.ne]: 'Deleted' }
    };

    // Add category filter if provided
    if (category) {
      whereClause.packageCategory = category;
    }

    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    // Add status filter if provided
    if (status) {
      whereClause.status = status;
    }

    const packages = await Package.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      packages
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch packages',
      error: error.message
    });
  }
};

// Get package by ID
const getPackageById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, message: 'Missing merchantId', error: 'merchantId is required' });
    }

    const packageData = await Package.findOne({
      where: { 
        id,
        merchantId,
        status: { [Op.ne]: 'Deleted' }
      }
    });

    if (!packageData) {
      return res.status(404).json({
        success: false,
        message: 'Package not found'
      });
    }

    res.json({
      success: true,
      package: packageData
    });
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch package',
      error: error.message
    });
  }
};

// Update package
const updatePackage = async (req, res) => {
  try {
    const { 
      id, 
      name, 
      type, 
      amount, 
      seedAmount, 
      seedType, 
      period, 
      collectionDays, 
      duration, 
      benefits, 
      description, 
      status,
      interestRate,
      extraCharges,
      defaultPenalty,
      defaultDays,
      // Loan-specific fields
      loanAmount,
      loanInterestRate,
      loanPeriod,
      defaultAmount,
      gracePeriod,
      loanCharges,
      packageCategory
    } = req.body;
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, message: 'Missing merchantId', error: 'merchantId is required' });
    }

    const packageData = await Package.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!packageData) {
      return res.status(404).json({
        success: false,
        message: 'Package not found'
      });
    }

    await packageData.update({
      name: name || packageData.name,
      type: type || packageData.type,
      amount: amount ? parseFloat(amount) : packageData.amount,
      seedAmount: seedAmount ? parseFloat(seedAmount) : packageData.seedAmount,
      seedType: seedType || packageData.seedType,
      period: period ? parseInt(period) : packageData.period,
      collectionDays: collectionDays || packageData.collectionDays,
      duration: duration ? parseInt(duration) : packageData.duration,
      benefits: benefits ? (Array.isArray(benefits) ? benefits : [benefits]) : packageData.benefits,
      description: description !== undefined ? description : packageData.description,
      status: status || packageData.status,
      interestRate: interestRate ? parseFloat(interestRate) : packageData.interestRate,
      extraCharges: extraCharges ? parseFloat(extraCharges) : packageData.extraCharges,
      defaultPenalty: defaultPenalty ? parseFloat(defaultPenalty) : packageData.defaultPenalty,
      defaultDays: defaultDays ? parseInt(defaultDays) : packageData.defaultDays,
      // Loan-specific fields
      loanAmount: loanAmount ? parseFloat(loanAmount) : packageData.loanAmount,
      loanInterestRate: loanInterestRate ? parseFloat(loanInterestRate) : packageData.loanInterestRate,
      loanPeriod: loanPeriod ? parseInt(loanPeriod) : packageData.loanPeriod,
      defaultAmount: defaultAmount ? parseFloat(defaultAmount) : packageData.defaultAmount,
      gracePeriod: gracePeriod ? parseInt(gracePeriod) : packageData.gracePeriod,
      loanCharges: loanCharges ? parseFloat(loanCharges) : packageData.loanCharges,
      packageCategory: packageCategory || packageData.packageCategory
    });

    res.json({
      success: true,
      message: 'Package updated successfully',
      package: packageData
    });
  } catch (error) {
    console.error('Error updating package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update package',
      error: error.message
    });
  }
};

// Delete package (soft delete)
const deletePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = resolveMerchantId(req);

    const packageData = await Package.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!packageData) {
      return res.status(404).json({
        success: false,
        message: 'Package not found'
      });
    }

    // Prevent deletion if used by customers
    const customersCount = await Customer.count({ where: { packageId: id } });
    if (customersCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete package as it is being used by ' + customersCount + ' customer(s). Please reassign them first.'
      });
    }

    // Prevent deletion if associated with collection records
    const collectionsCount = await Collection.count({ where: { packageId: id } });
    if (collectionsCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete package as it has ' + collectionsCount + ' associated collection records.'
      });
    }

    await packageData.update({ status: 'Deleted' });

    res.json({
      success: true,
      message: 'Package deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete package',
      error: error.message
    });
  }
};

// Get active packages (for customer selection)
const getActivePackages = async (req, res) => {
  try {
    const merchantId = resolveMerchantId(req);
    const { category } = req.query;

    let whereClause = { 
      merchantId,
      status: 'Active'
    };

    // Add category filter if provided
    if (category) {
      whereClause.packageCategory = category;
    }

    const packages = await Package.findAll({
      where: whereClause,
      order: [['amount', 'ASC']]
    });

    res.json({
      success: true,
      packages
    });
  } catch (error) {
    console.error('Error fetching active packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active packages',
      error: error.message
    });
  }
};

module.exports = {
  createPackage,
  getPackages,
  getPackageById,
  updatePackage,
  deletePackage,
  getActivePackages
};

