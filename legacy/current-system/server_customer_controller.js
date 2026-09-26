const { Customer, Agent, Branch, Merchant, Package } = require('../models');

/**
 * @swagger
 * /customers:
 *   get:
 *     summary: Get all customers
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by customer name, email, or account number
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: integer
 *         description: Filter by agent ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         description: Filter by branch ID
 *       - in: query
 *         name: packageId
 *         schema:
 *           type: integer
 *         description: Filter by package ID
 *     responses:
 *       200:
 *         description: List of customers retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Customers retrieved successfully"
 *               customers:
 *                 - id: 1
 *                   fullName: "John Doe"
 *                   email: "john.doe@example.com"
 *                   phoneNumber: "+2348012345678"
 *                   accountNumber: "ACC123456"
 *                   alias: "Johnny"
 *                   address: "123 Main Street, Lagos, Nigeria"
 *                   agentId: 1
 *                   branchId: 1
 *                   merchantId: 1
 *                   packageId: 801
 *                   status: "active"
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *       401:
 *         description: Unauthorized - invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create a new customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - phoneNumber
 *               - email
 *               - agentId
 *               - branchId
 *               - merchantId
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: "John Doe"
 *               phoneNumber:
 *                 type: string
 *                 example: "+2348012345678"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               alias:
 *                 type: string
 *                 example: "Johnny"
 *               address:
 *                 type: string
 *                 example: "123 Main Street, Lagos, Nigeria"
 *               accountNumber:
 *                 type: string
 *                 example: "ACC123456"
 *               agentId:
 *                 type: integer
 *                 example: 1
 *               branchId:
 *                 type: integer
 *                 example: 1
 *               merchantId:
 *                 type: integer
 *                 example: 1
 *               packageId:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       201:
 *         description: Customer created successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Customer created successfully"
 *               customer:
 *                 id: 21
 *                 accountNumber: "ACC998877"
 *                 fullName: "Jane Doe"
 *                 email: "jane.doe@example.com"
 *                 phoneNumber: "+2348090000000"
 *                 alias: "Jane"
 *                 address: "456 Oak Avenue, Abuja, Nigeria"
 *                 agentId: 3
 *                 branchId: 2
 *                 merchantId: 1
 *                 packageId: 801
 *                 status: "active"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Bad request - email already exists or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Agent, branch, or merchant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /customers/{id}:
 *   get:
 *     summary: Get customer by ID
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Customer retrieved successfully"
 *               customer:
 *                 id: 1
 *                 fullName: "John Doe"
 *                 email: "john.doe@example.com"
 *                 phoneNumber: "+2348012345678"
 *                 accountNumber: "ACC123456"
 *                 alias: "Johnny"
 *                 address: "123 Main Street, Lagos, Nigeria"
 *                 agentId: 1
 *                 branchId: 1
 *                 merchantId: 1
 *                 packageId: 801
 *                 status: "active"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   put:
 *     summary: Update customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 example: 1
 *               fullName:
 *                 type: string
 *                 example: "John Doe Updated"
 *               phoneNumber:
 *                 type: string
 *                 example: "+2348012345678"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe.updated@example.com"
 *               alias:
 *                 type: string
 *                 example: "Johnny Updated"
 *               address:
 *                 type: string
 *                 example: "456 New Street, Lagos, Nigeria"
 *               accountNumber:
 *                 type: string
 *                 example: "ACC123456"
 *               agentId:
 *                 type: integer
 *                 example: 1
 *               branchId:
 *                 type: integer
 *                 example: 1
 *               packageId:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Customer updated successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Customer updated successfully"
 *               customer:
 *                 id: 1
 *                 fullName: "John Doe Updated"
 *                 email: "john.doe.updated@example.com"
 *                 phoneNumber: "+2348012345678"
 *                 accountNumber: "ACC123456"
 *                 alias: "Johnny Updated"
 *                 address: "456 New Street, Lagos, Nigeria"
 *                 agentId: 1
 *                 branchId: 1
 *                 merchantId: 1
 *                 packageId: 801
 *                 status: "active"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Bad request - email already taken or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Customer, agent, or branch not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Create customer
const createCustomer = async (req, res) => {
  try {
    const { name, fullName, phoneNumber, email, agentId, branchId, merchantId, packageId, accountNumber, alias, address } = req.body;

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ where: { email } });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Verify agent exists
    const agent = await Agent.findByPk(agentId);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    // Verify branch exists
    const branch = await Branch.findByPk(branchId);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Verify merchant exists
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    // Create customer
    const customer = await Customer.create({
      name,
      fullName,
      phoneNumber,
      email,
      alias,
      address,
      agentId,
      branchId,
      merchantId,
      packageId,
      accountNumber,
    });

    // Create Virtual Account via TransactPay
    try {
        const names = fullName ? fullName.trim().split(' ') : ['Guest'];
        const firstname = names[0];
        const lastname = names.length > 1 ? names.slice(1).join(' ') : 'User';
        
        const { createVirtualAccount } = require('../utils/transactPay');
        const tpResult = await createVirtualAccount({
            firstname,
            lastname,
            email,
            phoneNumber,
            address: address || 'Lagos, Nigeria'
        });

        if (tpResult && tpResult.status === 'success') {
            const accNum = tpResult.accountNumber;
            
            if (accNum) {
                console.log(`Updating customer ${customer.id} with account number: ${accNum}`);
                await customer.update({ accountNumber: accNum });
                customer.accountNumber = accNum; 
            }
        }
    } catch (tpError) {
        console.error('TransactPay Integration Error:', tpError);
    }

    // Create Customer Wallet entry
    try {
        const { CustomerWallet } = require('../models');
        await CustomerWallet.create({
            customerId: customer.id,
            merchantId: merchantId,
            accountNumber: customer.accountNumber || `CW${Date.now()}`,
            balance: 0.00,
            status: 'Active'
        });
        console.log(`Created wallet for customer ${customer.id}`);
    } catch (walletError) {
        console.error('Error creating customer wallet:', walletError);
    }

    res.status(201).json({
      message: 'Customer created successfully',
      customer: {
        id: customer.id,
        accountNumber: customer.accountNumber,
        fullName: customer.fullName,
        email: customer.email,
        phoneNumber: customer.phoneNumber,
        agentId: customer.agentId,
        branchId: customer.branchId,
      },
    });
  } catch (error) {
    console.error('Customer creation error:', error);
    res.status(500).json({ message: 'Customer creation failed', error: error.message });
  }
};

// List all customers
const listCustomers = async (req, res) => {
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

    const customers = await Customer.findAll({
      where: { merchantId },
      attributes: ['id', 'fullName', 'phoneNumber', 'email', 'alias', 'address', 'accountNumber', 'createdAt', 'agentId', 'branchId', 'packageId'],
      include: [
        {
          model: Agent,
          as: 'Agent',
          attributes: ['id', 'fullName', 'email'],
        },
        {
          model: Branch,
          as: 'Branch',
          attributes: ['id', 'name', 'location'],
        },
        {
          model: Package,
          as: 'Package',
          attributes: ['id', 'name'],
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
      message: 'Customers retrieved successfully',
      customers: customers.map(c => ({
        ...c.toJSON(),
        accountNumber: c.accountNumber,
        agentName: c.Agent?.fullName,
        branchName: c.Branch?.name,
        packageName: c.Package?.name,
        dateCreated: c.createdAt,
        status: 'Active',
      })),
    });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ message: 'Failed to retrieve customers', error: error.message });
  }
};

// Get customer by ID
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByPk(id, {
      include: [
        {
          model: Agent,
          as: 'Agent',
          attributes: ['id', 'fullName', 'email'],
        },
        {
          model: Branch,
          as: 'Branch',
          attributes: ['id', 'name', 'location'],
        },
        {
          model: Merchant,
          as: 'Merchant',
          attributes: ['id', 'businessName'],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({
      message: 'Customer retrieved successfully',
      customer,
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ message: 'Failed to retrieve customer', error: error.message });
  }
};

// Update customer
const updateCustomer = async (req, res) => {
  try {
    const { id, fullName, phoneNumber, email, agentId, branchId, packageId, accountNumber, alias, address } = req.body;

    const customer = await Customer.findByPk(id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check if email is being changed and if it's already taken
    if (email !== customer.email) {
      const existingCustomer = await Customer.findOne({ where: { email } });
      if (existingCustomer) {
        return res.status(400).json({ message: 'Email already taken' });
      }
    }

    // Verify agent exists if provided
    if (agentId) {
      const agent = await Agent.findByPk(agentId);
      if (!agent) {
        return res.status(404).json({ message: 'Agent not found' });
      }
    }

    // Verify branch exists if provided
    if (branchId) {
      const branch = await Branch.findByPk(branchId);
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found' });
      }
    }

    // Update customer
    await customer.update({
      fullName,
      phoneNumber,
      email,
      alias,
      address,
      agentId,
      branchId,
      packageId,
      accountNumber,
    });

    res.json({
      message: 'Customer updated successfully',
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
        phoneNumber: customer.phoneNumber,
        agentId: customer.agentId,
        branchId: customer.branchId,
      },
    });
  } catch (error) {
    console.error('Customer update error:', error);
    res.status(500).json({ message: 'Customer update failed', error: error.message });
  }
};

module.exports = {
  createCustomer,
  listCustomers,
  getCustomerById,
  updateCustomer,
};

