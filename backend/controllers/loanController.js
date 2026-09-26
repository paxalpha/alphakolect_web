const db = require('../models');
const { Loan, Customer, Agent, Staff, Package, Charge, ChargeAssignment, CustomerWallet, WalletTransaction } = db;
const { Op } = require('sequelize');
const { postJournalForTransaction } = require('../utils/transactionMapping');

/**
 * @swagger
 * tags:
 *   - name: Loans
 *     description: Loan management
 * /loans:
 *   get:
 *     summary: Get all loans
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Completed, Defaulted, All]
 *         description: Filter by loan status
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
 *         name: agentId
 *         schema:
 *           type: integer
 *         description: Filter by agent ID
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
 *         description: Loans retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: 10
 *                   customerId: 12
 *                   customerName: "John Doe"
 *                   accountNumber: "ACC123456"
 *                   loanAmount: 50000.00
 *                   interestRate: 15.5
 *                   duration: 12
 *                   agentId: 3
 *                   agentName: "Agent Smith"
 *                   branch: "Main Branch"
 *                   totalAmount: 57500.00
 *                   remainingAmount: 45000.00
 *                   amountPaid: 12500.00
 *                   status: "Active"
 *                   merchantId: 1
 *                   dateIssued: "2024-01-15T00:00:00.000Z"
 *                   dueDate: "2025-01-15T00:00:00.000Z"
 *                   notes: "Business expansion loan for equipment purchase"
 *                   approvedBy: 2
 *                   approvedAt: "2024-01-15T14:30:00.000Z"
 *                   nextPaymentDate: "2024-02-15T00:00:00.000Z"
 *                   loanType: "Business Loan"
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *               pagination:
 *                 currentPage: 1
 *                 totalPages: 5
 *                 totalItems: 45
 *                 itemsPerPage: 10
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create a new loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [customerName, loanAmount, interestRate, duration, dueDate]
 *             properties:
 *               customerName:
 *                 type: string
 *                 description: Customer full name
 *                 example: "John Doe"
 *               accountNumber:
 *                 type: string
 *                 description: Customer account number
 *                 example: "ACC123456"
 *               loanAmount:
 *                 type: number
 *                 format: float
 *                 description: Loan amount
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
 *                 description: Agent ID handling the loan
 *                 example: 1
 *               branch:
 *                 type: string
 *                 description: Branch name
 *                 example: "Main Branch"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Customer has good credit history"
 *               dueDate:
 *                 type: string
 *                 format: date
 *                 description: Loan due date
 *                 example: "2024-12-31"
 *               loanForm:
 *                 type: string
 *                 format: binary
 *                 description: Loan form file upload
 *     responses:
 *       201:
 *         description: Loan created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Loan created successfully"
 *               data:
 *                 id: 10
 *                 customerId: 12
 *                 customerName: "John Doe"
 *                 accountNumber: "ACC123456"
 *                 loanAmount: 50000.00
 *                 interestRate: 15.5
 *                 duration: 12
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 totalAmount: 57500.00
 *                 remainingAmount: 57500.00
 *                 amountPaid: 0.00
 *                 status: "Pending"
 *                 merchantId: 1
 *                 dateIssued: "2024-01-15T00:00:00.000Z"
 *                 dueDate: "2025-01-15T00:00:00.000Z"
 *                 notes: "Business expansion loan for equipment purchase"
 *                 approvedBy: null
 *                 approvedAt: null
 *                 nextPaymentDate: "2024-02-15T00:00:00.000Z"
 *                 loanType: "Business Loan"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
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
 * /loans/{id}:
 *   get:
 *     summary: Get loan by ID
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID
 *     responses:
 *       200:
 *         description: Loan retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: 10
 *                 customerId: 12
 *                 customerName: "John Doe"
 *                 accountNumber: "ACC123456"
 *                 loanAmount: 50000.00
 *                 interestRate: 15.5
 *                 duration: 12
 *                 agentId: 3
 *                 agentName: "Agent Smith"
 *                 branch: "Main Branch"
 *                 totalAmount: 57500.00
 *                 remainingAmount: 45000.00
 *                 amountPaid: 12500.00
 *                 status: "Active"
 *                 merchantId: 1
 *                 dateIssued: "2024-01-15T00:00:00.000Z"
 *                 dueDate: "2025-01-15T00:00:00.000Z"
 *                 notes: "Business expansion loan for equipment purchase"
 *                 approvedBy: 2
 *                 approvedAt: "2024-01-15T14:30:00.000Z"
 *                 nextPaymentDate: "2024-02-15T00:00:00.000Z"
 *                 loanType: "Business Loan"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Loan not found
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
 *     summary: Delete loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID
 *     responses:
 *       200:
 *         description: Loan deleted successfully
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
 *                   example: "Loan deleted successfully"
 *       404:
 *         description: Loan not found
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
 * /loans/{id}/status:
 *   put:
 *     summary: Update loan status
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID
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
 *                 enum: [Active, Completed, Defaulted]
 *                 description: New loan status
 *                 example: "Active"
 *               notes:
 *                 type: string
 *                 description: Additional notes
 *                 example: "Loan activated after approval"
 *     responses:
 *       200:
 *         description: Loan status updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Loan status updated successfully"
 *               data:
 *                 id: 10
 *                 status: "Active"
 *       404:
 *         description: Loan not found
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
 * /loans/stats/summary:
 *   get:
 *     summary: Get loan statistics summary
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loan statistics retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 totalLoans: 120
 *                 activeLoans: 45
 *                 completedLoans: 60
 *                 defaultedLoans: 15
 *                 totalAmount: 2500000
 *                 totalCollection: 1750000
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Create a new loan
const createLoan = async (req, res) => {
  try {
    const { 
      customerName, 
      accountNumber, 
      loanAmount, 
      interestRate, 
      duration, 
      agentId, 
      branch, 
      notes,
      dueDate
    } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    // Handle uploaded file
    let formUrl = null;
    if (req.file) {
      // Expose via static uploads route
      formUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
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
          message: 'A loan is already running on this account number. It must be fully paid off before creating another.'
        });
      }
    }

    // Find agent if provided
    let agent = null;
    if (agentId) {
      agent = await Agent.findOne({
        where: {
          id: agentId,
          merchantId: merchantId
        }
      });
    }

    // Calculate total amount and remaining amount
    const principal = parseFloat(loanAmount);
    let interest = 0;
    const rateNum = parseFloat(interestRate || 0);
    let loanChargesAmount = 0;

    if (req.body.packageName) {
      try {
        const pkg = await Package.findOne({ where: { merchantId, name: req.body.packageName } });
        if (pkg) {
          const type = String(pkg.type || pkg.packageType || '').toLowerCase();
          const isFlat = type.includes('flat') || (pkg.interestAmount !== undefined && pkg.interestAmount !== null && Number(pkg.interestAmount) > 0 && !pkg.loanInterestRate);
          if (isFlat) {
            interest = parseFloat(pkg.interestAmount || pkg.interest_amount || rateNum || 0);
          } else {
            const pctRate = parseFloat(pkg.loanInterestRate || pkg.loan_interest_rate || rateNum || 0);
            interest = principal * (pctRate / 100);
          }
          loanChargesAmount = parseFloat(pkg.loanCharges || 0);
        }
      } catch (_) {}
    }

    if (interest === 0 && rateNum > 0) {
      if (rateNum > 100) {
        interest = rateNum; // Flat rate amount
      } else {
        interest = principal * (rateNum / 100);
      }
    }

    const totalAmount = principal + interest;

    const enrichedNotes = formUrl ? JSON.stringify({ formUrl, notes: notes || null }) : notes;

    const loan = await Loan.create({
      customerId: customer.id,
      customerName,
      accountNumber,
      loanAmount: principal,
      interestRate,
      duration,
      agentId: agent ? agent.id : null,
      agentName: agent ? agent.fullName : null,
      branch,
      merchantId,
      dueDate: new Date(dueDate),
      notes: enrichedNotes,
      totalAmount,
      remainingAmount: totalAmount,
      amountPaid: 0,
      packageName: req.body.packageName || null
      // formUrl not stored as a separate column; embedded in notes JSON
    });

    // Book double-entry journal: Loan Disbursement — Dr Customer Loans / Cr Customer Wallet Deposits
    try {
      await postJournalForTransaction(
        'LOAN_DISBURSEMENT',
        parseFloat(loanAmount),
        merchantId,
        `Loan #${loan.id} to ${customerName}`
      );
    } catch (deErr) {
      console.warn('⚠️ Double-entry booking skipped for loan disbursement:', deErr.message);
    }

    // Deduct package loan charges from customer's collection wallet
    if (loanChargesAmount > 0) {
      try {
        const deductionTransaction = await db.sequelize.transaction();
        try {
          // Find or create a Charge record for this package charge
          const chargeName = `Loan Charge - ${req.body.packageName || 'Loan'}`;
          let charge = await Charge.findOne({
            where: { chargeName, merchantId, isActive: true },
            transaction: deductionTransaction
          });
          if (!charge) {
            charge = await Charge.create({
              chargeName,
              type: 'Loan',
              amount: loanChargesAmount,
              merchantId,
              isActive: true
            }, { transaction: deductionTransaction });
          }

          // Deduct from collection wallet
          const wallet = await CustomerWallet.findOne({
            where: { customerId: customer.id, merchantId },
            lock: deductionTransaction.LOCK.UPDATE,
            transaction: deductionTransaction
          });

          const oldBalance = wallet ? parseFloat(wallet.collectionBalance || 0) : 0;
          const newBalance = oldBalance - loanChargesAmount;

          if (wallet) {
            await wallet.update({ collectionBalance: newBalance }, { transaction: deductionTransaction });
          } else {
            await CustomerWallet.create({
              customerId: customer.id,
              merchantId,
              collectionBalance: newBalance
            }, { transaction: deductionTransaction });
          }

          // Create charge assignment (paid immediately)
          const assignment = await ChargeAssignment.create({
            chargeId: charge.id,
            customerId: customer.id,
            amount: loanChargesAmount,
            dueDate: new Date(),
            merchantId,
            status: 'Paid',
            datePaid: new Date()
          }, { transaction: deductionTransaction });

          // Record wallet transaction
          await WalletTransaction.create({
            transactionType: 'charge_deduction',
            merchantId,
            type: 'debit',
            amount: loanChargesAmount,
            description: `Loan Package Charge deducted: ${req.body.packageName || 'N/A'} (Loan #${loan.id})`,
            status: 'Completed',
            balanceBefore: oldBalance,
            balanceAfter: newBalance,
            category: 'charge',
            relatedId: assignment.id,
            relatedType: 'ChargeAssignment'
          }, { transaction: deductionTransaction });

          await deductionTransaction.commit();
          console.log(`✅ Loan charges ₦${loanChargesAmount} deducted from collection wallet for loan #${loan.id}`);

          // Book double-entry journal for charge deduction
          try {
            await postJournalForTransaction(
              'CHARGE_DEDUCTION',
              loanChargesAmount,
              merchantId,
              `Loan Charge for Loan #${loan.id} — ${req.body.packageName || 'Package'}`
            );
          } catch (chargeJeErr) {
            console.warn('⚠️ Journal entry skipped for charge deduction:', chargeJeErr.message);
          }
        } catch (innerErr) {
          await deductionTransaction.rollback();
          console.warn('⚠️ Loan charge deduction failed:', innerErr.message);
        }
      } catch (txErr) {
        console.warn('⚠️ Loan charge deduction skipped:', txErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Loan created successfully',
      data: {
        ...loan.toJSON(),
        formUrl: formUrl || (typeof loan.notes === 'string' && loan.notes.startsWith('{') ? (JSON.parse(loan.notes).formUrl || null) : null)
      }
    });
  } catch (error) {
    console.error('Error creating loan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create loan',
      error: error.message
    });
  }
};

// Get all loans with filtering, search, and pagination
const getLoans = async (req, res) => {
  try {
    const { 
      status, 
      search, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 10,
      agentId,
      customerId
    } = req.query;
    const merchantId = req.user.merchantId || req.user.id;

    const whereClause = { merchantId };

    if (customerId) {
      whereClause.customerId = parseInt(customerId);
    }

    // Status filter
    if (status && status !== 'All') {
      whereClause.status = status;
    }

    // Date range filter
    if (fromDate && toDate) {
      whereClause.dateIssued = {
        [Op.between]: [new Date(fromDate), new Date(toDate)]
      };
    }

    // Agent filter
    if (agentId && agentId !== 'All') {
      whereClause.agentId = agentId;
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { customerName: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { agentName: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const offset = (page - 1) * limit;
    
    const { count, rows: loans } = await Loan.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['dateIssued', 'DESC']],
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'phoneNumber'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName'] }
      ]
    });

    const totalPages = Math.ceil(count / limit);

    const isValidPackageName = (name, custName) => {
      if (!name || typeof name !== 'string') return false;
      const cleanPkg = name.trim().toLowerCase();
      const cleanCust = String(custName || '').trim().toLowerCase();
      return Boolean(cleanPkg && (!cleanCust || cleanPkg !== cleanCust));
    };

    const serialized = await Promise.all(loans.map(async l => {
      const json = l.toJSON();
      let parsedFormUrl = null;
      if (typeof json.notes === 'string' && json.notes.startsWith('{')) {
        try { parsedFormUrl = JSON.parse(json.notes).formUrl || null; } catch {}
      }
      
      let packageName = isValidPackageName(json.packageName, json.customerName) ? json.packageName : null;
      
      if (!packageName) {
        try {
          const { LoanApplication } = require('../models');
          const appWhere = { merchantId };
          if (json.accountNumber) appWhere.accountNumber = json.accountNumber;
          else if (json.customerId) appWhere.customerId = json.customerId;
          const app = await LoanApplication.findOne({
            where: appWhere,
            order: [['dateApplied', 'DESC']],
            attributes: ['packageName']
          });
          if (app && isValidPackageName(app.packageName, json.customerName)) {
            packageName = app.packageName;
          }
        } catch (_) {}
      }

      if (!packageName && json.loanAmount) {
        try {
          const { Package } = require('../models');
          const matchedPkg = await Package.findOne({
            where: {
              merchantId,
              [Op.or]: [
                { loanAmount: json.loanAmount },
                { amount: json.loanAmount }
              ]
            }
          });
          if (matchedPkg && isValidPackageName(matchedPkg.name, json.customerName)) {
            packageName = matchedPkg.name;
          }
        } catch (_) {}
      }

      return { ...json, packageName: packageName || null, formUrl: parsedFormUrl };
    }));

    res.json({
      success: true,
      data: serialized,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loans',
      error: error.message
    });
  }
};

// Get loan by ID
const getLoanById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.merchantId || req.user.id;

    const loan = await Loan.findOne({
      where: { id, merchantId },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'fullName', 'phoneNumber'] },
        { model: Agent, as: 'agent', attributes: ['id', 'fullName'] }
      ]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    const json = loan.toJSON();
    const loanAmount = parseFloat(json.loanAmount || 0);
    const amountPaid = parseFloat(json.amountPaid || 0);
    const storedTotal = parseFloat(json.totalAmount || 0);

    let interest = 0;
    if (storedTotal > loanAmount) {
      interest = storedTotal - loanAmount;
    } else if (parseFloat(json.interestRate || 0) > 0) {
      const rate = parseFloat(json.interestRate);
      const durationInMonths = parseInt(json.duration || 30) / 30;
      interest = loanAmount * (rate / 100) * durationInMonths;
    }

    const isValidPackageName = (name, custName) => {
      if (!name || typeof name !== 'string') return false;
      const cleanPkg = name.trim().toLowerCase();
      const cleanCust = String(custName || '').trim().toLowerCase();
      return Boolean(cleanPkg && (!cleanCust || cleanPkg !== cleanCust));
    };

    // If packageName is not on the loan itself or is equal to customer name, look it up
    let packageName = isValidPackageName(json.packageName, json.customerName) ? json.packageName : null;

    if (!packageName) {
      try {
        const { LoanApplication } = require('../models');
        const appWhere = { merchantId };
        if (json.accountNumber) appWhere.accountNumber = json.accountNumber;
        else if (json.customerId) appWhere.customerId = json.customerId;
        const app = await LoanApplication.findOne({
          where: appWhere,
          order: [['dateApplied', 'DESC']],
          attributes: ['packageName']
        });
        if (app && isValidPackageName(app.packageName, json.customerName)) {
          packageName = app.packageName;
        }
      } catch (_) {}
    }

    if (!packageName) {
      try {
        const { Repayment } = require('../models');
        const rep = await Repayment.findOne({
          where: { loanId: json.id },
          order: [['createdAt', 'DESC']],
          attributes: ['package']
        });
        if (rep && isValidPackageName(rep.package, json.customerName)) {
          packageName = rep.package;
        }
      } catch (_) {}
    }

    if (!packageName) {
      try {
        const { Package, Customer } = require('../models');
        if (json.customerId) {
          const cust = await Customer.findByPk(json.customerId, { include: [{ model: Package, as: 'Package' }] });
          if (cust && cust.Package && isValidPackageName(cust.Package.name, json.customerName)) {
            packageName = cust.Package.name;
          }
        }
        if (!packageName && json.loanAmount) {
          const matchedPkg = await Package.findOne({
            where: {
              merchantId,
              [Op.or]: [
                { loanAmount: json.loanAmount },
                { amount: json.loanAmount }
              ]
            }
          });
          if (matchedPkg && isValidPackageName(matchedPkg.name, json.customerName)) {
            packageName = matchedPkg.name;
          }
        }
      } catch (_) {}
    }

    // Fallback: If interest was 0, check package for interestAmount or interestRate
    if (interest === 0 && packageName) {
      try {
        const { Package } = require('../models');
        const pkg = await Package.findOne({ where: { merchantId, name: packageName } });
        if (pkg) {
          if (pkg.interestAmount && parseFloat(pkg.interestAmount) > 0) {
            interest = parseFloat(pkg.interestAmount);
          } else if (pkg.interestRate && parseFloat(pkg.interestRate) > 0) {
            const rate = parseFloat(pkg.interestRate);
            const durationInMonths = parseInt(pkg.duration || json.duration || 30) / 30;
            interest = loanAmount * (rate / 100) * durationInMonths;
          }
        }
      } catch (_) {}
    }

    const totalExpected = loanAmount + interest;
    const outstanding = Math.max(0, totalExpected - amountPaid);


    res.json({
      success: true,
      data: { ...json, outstandingAmount: outstanding, packageName: packageName || null }
    });
  } catch (error) {
    console.error('Error fetching loan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan',
      error: error.message
    });
  }
};

// Update loan status
const updateLoanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const merchantId = req.user.merchantId || req.user.id;

    const loan = await Loan.findOne({
      where: { id, merchantId }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    const updateData = { status };
    if (notes) updateData.notes = notes;
    if (status === 'Active') {
      let approverId = null;
      // Prefer explicit staffId on token if present
      if (req.user && req.user.staffId) {
        approverId = req.user.staffId;
      } else if (req.user && req.user.type === 'staff') {
        // Fallback: if token represents staff, ensure it exists in Staff table
        const staff = await Staff.findByPk(req.user.id);
        if (staff) {
          approverId = staff.id;
        }
      }

      if (approverId) {
        updateData.approvedBy = approverId;
        updateData.approvedAt = new Date();
      }
    }

    await loan.update(updateData);

    res.json({
      success: true,
      message: 'Loan status updated successfully',
      data: loan
    });
  } catch (error) {
    console.error('Error updating loan status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update loan status',
      error: error.message
    });
  }
};

// Delete loan
const deleteLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.merchantId || req.user.id;

    const loan = await Loan.findOne({
      where: { id, merchantId }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Book double-entry reversal for loan deletion
    try {
      const { postReversalForTransaction } = require('../utils/transactionMapping');
      await postReversalForTransaction(
        'LOAN_DISBURSEMENT',
        loan.loanAmount,
        merchantId,
        `Original Loan ID: ${loan.id}, Customer: ${loan.customerName || 'N/A'}`
      );
    } catch (err) {
      console.warn(`⚠️ Reversal failed during loan delete: ${err.message}`);
    }

    await loan.destroy();

    res.json({
      success: true,
      message: 'Loan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting loan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete loan',
      error: error.message
    });
  }
};

// Get loan statistics
const getLoanStats = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;

    const totalLoans = await Loan.count({ where: { merchantId } });
    const activeLoans = await Loan.count({ where: { merchantId, status: 'Active' } });
    const completedLoans = await Loan.count({ where: { merchantId, status: 'Completed' } });
    const defaultedLoans = await Loan.count({ where: { merchantId, status: 'Defaulted' } });

    const totalAmount = await Loan.sum('loanAmount', { where: { merchantId } });
    const totalCollection = await Loan.sum('amountPaid', { where: { merchantId } });

    res.json({
      success: true,
      data: {
        totalLoans,
        activeLoans,
        completedLoans,
        defaultedLoans,
        totalAmount: totalAmount || 0,
        totalCollection: totalCollection || 0
      }
    });
  } catch (error) {
    console.error('Error fetching loan stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan statistics',
      error: error.message
    });
  }
};

module.exports = {
  createLoan,
  getLoans,
  getLoanById,
  updateLoanStatus,
  deleteLoan,
  getLoanStats
};

