const db = require('../models');
const { Loan, Staff, LoanApplication } = db;
const { Op } = require('sequelize');

// Create a new loan
const createLoan = async (req, res) => {
  try {
    const { 
      customerId, 
      loanAmount, 
      interestRate, 
      duration, 
      startDate, 
      repaymentFrequency,
      loanType,
      agentId,
      branchId,
      applicationId 
    } = req.body;
    const merchantId = req.user.id;

    const transaction = await db.sequelize.transaction();
    try {
      const loan = await Loan.create({
        customerId,
        loanAmount,
        remainingAmount: loanAmount, // Initial remaining amount is full loan amount
        interestRate,
        duration,
        startDate,
        repaymentFrequency,
        loanType,
        agentId,
        branchId,
        applicationId,
        merchantId,
        status: 'Active' // Default to Active when created from approved application
      }, { transaction });

      // Update Wallet Loan Balance
      const { CustomerWallet } = require('../models');
      let wallet = await CustomerWallet.findOne({ where: { customerId, merchantId }, transaction });
      if (wallet) {
        const activeLoans = await Loan.findAll({ where: { customerId, merchantId, status: 'Active' }, transaction });
        const totalRemaining = activeLoans.reduce((sum, l) => sum + parseFloat(l.remainingAmount || 0), 0);
        await wallet.update({ loanBalance: totalRemaining }, { transaction });
      }

      // Book double-entry transaction (Disbursement: Debit Customer Loans Liability, Credit Cash)
      const { bookDoubleEntry } = require('../utils/doubleEntry');
      await bookDoubleEntry(merchantId, {
        date: new Date(),
        description: `Loan Disbursed - Loan #${loan.id} (Customer ID: ${customerId})`,
        debitCode: '200500',
        creditCode: '100400',
        amount: parseFloat(loanAmount),
        transaction
      });

      await transaction.commit();

      res.status(201).json({
        success: true,
        message: 'Loan created successfully',
        data: loan
      });
    } catch (innerError) {
      await transaction.rollback();
      throw innerError;
    }
  } catch (error) {
    console.error('Error creating loan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create loan',
      error: error.message
    });
  }
};

// Get all loans
const getLoans = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { status, customerId } = req.query;

    const where = { merchantId };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const loans = await Loan.findAll({
      where,
      include: [
        { model: db.Customer, attributes: ['fullName', 'accountNumber'] },
        { model: db.Agent, attributes: ['fullName'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: loans
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
    const merchantId = req.user.id;

    const loan = await Loan.findOne({
      where: { id, merchantId },
      include: [
        { model: db.Customer, attributes: ['fullName', 'accountNumber'] },
        { model: db.Agent, attributes: ['fullName'] },
        { model: db.Repayment, order: [['repaymentDate', 'DESC']] }
      ]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    const json = loan.toJSON();
    const totalPaid = (json.Repayments || []).reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    const outstanding = Math.max(0, parseFloat(json.loanAmount) - totalPaid);

    // If packageName is not on the loan itself, look it up from the linked loan application
    let packageName = json.packageName || null;
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
        if (app && app.packageName) packageName = app.packageName;
      } catch (_) {}
    }

    // Final fallback: look up package name from most recent repayment for this loan
    if (!packageName) {
      try {
        const { Repayment } = require('../models');
        const rep = await Repayment.findOne({
          where: { loanId: json.id },
          order: [['createdAt', 'DESC']],
          attributes: ['package']
        });
        if (rep && rep.package) packageName = rep.package;
      } catch (_) {}
    }

    res.json({
      success: true,
      data: { ...json, outstandingAmount: outstanding, packageName }
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
    const merchantId = req.user.id;

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

    // Update Wallet Loan Balance
    const { CustomerWallet } = require('../models');
    let wallet = await CustomerWallet.findOne({ where: { customerId: loan.customerId, merchantId } });
    if (wallet) {
      const activeLoans = await Loan.findAll({ where: { customerId: loan.customerId, merchantId, status: 'Active' } });
      const totalRemaining = activeLoans.reduce((sum, l) => sum + parseFloat(l.remainingAmount || 0), 0);
      await wallet.update({ loanBalance: totalRemaining });
    }

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
    const merchantId = req.user.id;

    const loan = await Loan.findOne({
      where: { id, merchantId }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
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
    const merchantId = req.user.id;

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
