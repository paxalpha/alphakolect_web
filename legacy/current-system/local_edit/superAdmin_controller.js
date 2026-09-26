const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SuperAdmin, Merchant, Transaction, Plan, Agent, Customer, AdminRole, AdminStaff, SupportTicket, TicketMessage, Announcement, Faq } = require('../models');
const { Op } = require("sequelize");
const PERMISSIONS = require('../utils/permissions');
const AdminLogService = require('../services/adminLogService');

// ====================
// Support Tickets
// ====================
const getAllTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.findAll({
      include: [
        { model: Merchant, as: 'merchant', attributes: ['id', 'businessName', 'email'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ success: false, message: "Failed to fetch tickets", error: error.message });
  }
};

const getTicketDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await SupportTicket.findByPk(id, {
      include: [
        { model: Merchant, as: 'merchant', attributes: ['id', 'businessName', 'email'] },
        { model: TicketMessage, as: 'messages', order: [['createdAt', 'ASC']] }
      ]
    });
    
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error("Error fetching ticket details:", error);
    res.status(500).json({ success: false, message: "Failed to fetch ticket details", error: error.message });
  }
};

const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, senderId } = req.body; // senderId is AdminStaff ID

    if (!message) return res.status(422).json({ message: "Message is required" });

    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    const newMessage = await TicketMessage.create({
      ticketId: id,
      senderType: 'admin',
      senderId: req.user.id || senderId, // Assuming req.user is populated by middleware
      message
    });

    // Optionally update ticket status to 'pending' (waiting for merchant) or 'open'
    // await ticket.update({ status: 'open' }); 

    res.json({ success: true, message: "Reply added", data: newMessage });
  } catch (error) {
    console.error("Error replying to ticket:", error);
    res.status(500).json({ success: false, message: "Failed to reply", error: error.message });
  }
};

const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    await ticket.update({ status });

    res.json({ success: true, message: "Ticket status updated", data: ticket });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    res.status(500).json({ success: false, message: "Failed to update status", error: error.message });
  }
};

// ====================
// Announcements
// ====================
const getAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: announcements });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    res.status(500).json({ success: false, message: "Failed to fetch announcements", error: error.message });
  }
};

const createAnnouncement = async (req, res) => {
  try {
    const { title, content, targetAudience } = req.body;

    if (!title || !content) return res.status(422).json({ message: "Title and content are required" });

    const announcement = await Announcement.create({
      title,
      content,
      targetAudience: targetAudience || 'all',
      createdBy: req.user.id
    });

    res.json({ success: true, message: "Announcement created", data: announcement });
  } catch (error) {
    console.error("Error creating announcement:", error);
    res.status(500).json({ success: false, message: "Failed to create announcement", error: error.message });
  }
};

const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const announcement = await Announcement.findByPk(id);
    
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found" });

    await announcement.destroy();
    res.json({ success: true, message: "Announcement deleted" });
  } catch (error) {
    console.error("Error deleting announcement:", error);
    res.status(500).json({ success: false, message: "Failed to delete announcement", error: error.message });
  }
};

// ====================
// FAQs
// ====================
const getAllFaqs = async (req, res) => {
  try {
    const faqs = await Faq.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: faqs });
  } catch (error) {
    console.error("Error fetching FAQs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch FAQs", error: error.message });
  }
};

const createFaq = async (req, res) => {
  try {
    const { question, answer, category } = req.body;

    if (!question || !answer) return res.status(422).json({ message: "Question and answer are required" });

    const faq = await Faq.create({
      question,
      answer,
      category: category || 'General'
    });

    res.json({ success: true, message: "FAQ created", data: faq });
  } catch (error) {
    console.error("Error creating FAQ:", error);
    res.status(500).json({ success: false, message: "Failed to create FAQ", error: error.message });
  }
};

const deleteFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const faq = await Faq.findByPk(id);
    
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found" });

    await faq.destroy();
    res.json({ success: true, message: "FAQ deleted" });
  } catch (error) {
    console.error("Error deleting FAQ:", error);
    res.status(500).json({ success: false, message: "Failed to delete FAQ", error: error.message });
  }
};

// ====================
// Super Admin Login
// ====================
const loginSuperAdmin = async (req, res) => {
  try {
    console.log('SuperAdmin:', SuperAdmin);

    const requiredFields = ["email", "password"];

    for (let field of requiredFields) {
      if (!req.body[field]) {
        return res.status(422).json({ message: `${field} is required` });
      }
    }

    const { email, password } = req.body;

    // Find super admin
    const superAdmin = await SuperAdmin.findOne({ where: { email } });
    if (!superAdmin) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, superAdmin.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      superAdmin: {
        id: superAdmin.id,
        name: superAdmin.name,
        email: superAdmin.email,
        role: superAdmin.roles,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// Get SuperAdmin dashboard stats
const getSuperAdminStats = async (req, res) => {
  try {
    // Count merchants
    const [totalMerchants, activeMerchants, inactiveMerchants] = await Promise.all([
      Merchant.count(),
      Merchant.count({ where: { status: 'Active' } }),
      Merchant.count({ where: { status: 'Inactive' } })
    ]);

    res.json({
      success: true,
      data: {
        totalMerchants,
        activeMerchants,
        inactiveMerchants
      }
    });
  } catch (error) {
    console.error('Error fetching superAdmin stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch superAdmin statistics',
      error: error.message
    });
  }
};

const getMerchantStats = async (req, res) => {
  try {
    const ALLOWED_DURATIONS = ['Last 3 months', 'Last 6 months', 'Last 12 months'];

    if (!ALLOWED_DURATIONS.includes(req.query.duration)) {
      return res.status(422).json({
        message: `Invalid duration. Allowed values are: ${ALLOWED_DURATIONS.join(', ')}`
      });
    }


    const { duration = 'Last 12 months' } = req.query;
    const now = new Date();
    let startDate;

    // Select time range
    switch (duration) {
      case 'Last 3 months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case 'Last 6 months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        break;
      case 'Last 12 months':
      default:
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        break;
    }

    const monthlyData = [];
    const currentDate = new Date(startDate);

    while (currentDate <= now) {
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const monthName = monthStart.toLocaleDateString('en-US', { month: 'short' });

      // Merchants registered this month
      const total = await Merchant.count({
        where: {
          createdAt: { [Op.between]: [monthStart, monthEnd] }
        }
      });

      const active = await Merchant.count({
        where: {
          status: 'Active',
          createdAt: { [Op.between]: [monthStart, monthEnd] }
        }
      });

      const inactive = await Merchant.count({
        where: {
          status: 'Inactive',
          createdAt: { [Op.between]: [monthStart, monthEnd] }
        }
      });

      monthlyData.push({
        name: monthName,
        Total: total,
        Active: active,
        Inactive: inactive
      });

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    res.json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error('Error fetching merchant stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchant statistics',
      error: error.message
    });
  }
};

const getAllActivities = async (req, res) => {
  try {
    // Dummy lookups (simulate fetching names from DB)
    const merchants = {
      101: 'ABC Stores',
      102: 'XYZ Limited'
    };

    const agents = {
      201: 'John Doe (Agent)',
      202: 'Jane Smith (Agent)'
    };

    const staff = {
      301: 'Michael Johnson (Staff)',
      302: 'Emily Brown (Staff)'
    };

    // Dummy activities
    const activities = [
      {
        id: 1,
        person: 'merchant',
        personId: 101,
        action: 'Created new order',
        details: 'Merchant created order #ORD1234',
        date: new Date().toISOString(),
      },
      {
        id: 2,
        person: 'agent',
        personId: 202,
        action: 'Approved transaction',
        details: 'Agent approved withdrawal of ₦50,000',
        date: new Date().toISOString(),
      },
      {
        id: 3,
        person: 'staff',
        personId: 301,
        action: 'Updated profile',
        details: 'Staff updated KYC details',
        date: new Date().toISOString(),
      },
    ];

    // Enrich activities with names (simulate DB join)
    const enrichedActivities = activities.map((activity) => {
      let personName = 'Unknown';

      switch (activity.person) {
        case 'merchant':
          personName = merchants[activity.personId] || 'Unknown Merchant';
          break;
        case 'agent':
          personName = agents[activity.personId] || 'Unknown Agent';
          break;
        case 'staff':
          personName = staff[activity.personId] || 'Unknown Staff';
          break;
      }

      return {
        ...activity,
        personName,
      };
    });

    res.json({
      success: true,
      data: enrichedActivities,
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities',
      error: error.message,
    });
  }
};


const getAllMerchants = async (req, res) => {
  try {
    const merchants = await Merchant.findAll({
      order: [['createdAt', 'DESC']], // latest merchants first
      include: [
        {
          model: Agent,
          as: 'agents',
          attributes: ['id'],
        },
        {
          model: Customer,
          as: 'customers',
          attributes: ['id'],
        },
      ],
    });

    // Transform merchants to include counts and plan info
    const merchantsWithCounts = await Promise.all(
      merchants.map(async (merchant) => {
        const merchantData = merchant.toJSON();
        
        // Count agents and customers
        const agentCount = merchantData.agents ? merchantData.agents.length : 0;
        const customerCount = merchantData.customers ? merchantData.customers.length : 0;
        
        // Get plan information (you can customize this based on your plan logic)
        // For now, using a simple logic based on verification status
        let planName = 'Free';
        if (merchantData.isVerified) {
          // You can add more sophisticated plan logic here
          // For example, check a plans table or merchant.planId
          planName = 'Basic';
        }
        
        return {
          ...merchantData,
          agentCount,
          customerCount,
          planName,
          // Remove the full agent/customer arrays to reduce response size
          agents: undefined,
          customers: undefined,
        };
      })
    );

    res.json({
      success: true,
      count: merchantsWithCounts.length,
      data: merchantsWithCounts,
    });
  } catch (error) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchants',
      error: error.message,
    });
  }
};

const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.findAll({
      include: [
        {
          model: Merchant,
          attributes: ['id', 'businessName', 'email']
        }
      ],
      attributes: [
        'id',
        'merchantId',
        'amount',
        'currency',
        'status',
        'type',
        'createdAt',
        'updatedAt'
      ],
      order: [['createdAt', 'DESC']] // latest transactions first
    });

    res.json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message,
    });
  }
};

const createPlan = async (req, res) => {
  try {
    const requiredFields = ["type", "name", "billing_cycle", "pricing"];
    for (let field of requiredFields) {
      if (!req.body[field]) {
        return res.status(422).json({ message: `${field} is required` });
      }
    }

    const {
      type,
      name,
      billing_cycle,
      pricing,
      start_date,
      end_date,
      merchant,
      no_of_branches,
      no_of_customers,
      no_of_agents
    } = req.body;

    let merchantId = null;

    // if merchant is provided, validate it
    if (merchant) {
      const foundMerchant = await Merchant.findByPk(merchant);
      if (!foundMerchant) {
        return res.status(404).json({ success: false, message: "Invalid merchant ID" });
      }
      merchantId = foundMerchant.id;
    }

     // ✅ validate start_date
    if (start_date && isNaN(Date.parse(start_date))) {
      return res.status(422).json({ success: false, message: "Invalid start_date format" });
    }

    // ✅ validate end_date
    if (end_date && isNaN(Date.parse(end_date))) {
      return res.status(422).json({ success: false, message: "Invalid end_date format" });
    }

    // ✅ ensure end_date is not before start_date
    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      return res.status(422).json({ success: false, message: "end_date cannot be earlier than start_date" });
    }

    const newPlan = await Plan.create({
      type,
      name,
      billing_cycle,
      pricing,
      start_date,
      end_date,
      merchantId,
      no_of_branches,
      no_of_customers,
      no_of_agents,
    });

    res.status(201).json({
      success: true,
      message: "Plan created successfully",
      data: newPlan
    });
  } catch (error) {
    console.error("Error creating plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create plan",
      error: error.message
    });
  }
};

const getAllPlans = async (req, res) => {
  try {
    const { type } = req.query; // filter by query param

    const whereClause = {};
    if (type) {
      whereClause.type = type; // apply filter only if provided
    }

    const plans = await Plan.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching plans:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch plans",
      error: error.message,
    });
  }
};

const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(422).json({ message: "Plan ID is required" });
    }

    const plan = await Plan.findByPk(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    const {
      type,
      name,
      billing_cycle,
      pricing,
      currency,
      features,
      max_agents,
      max_customers,
      max_transactions,
      status,
      description,
      merchantId
    } = req.body;

    // Validate merchant if provided
    if (merchantId) {
      const foundMerchant = await Merchant.findByPk(merchantId);
      if (!foundMerchant) {
        return res.status(404).json({ success: false, message: "Invalid merchant ID" });
      }
    }

    // Update plan
    await plan.update({
      ...(type && { type }),
      ...(name && { name }),
      ...(billing_cycle && { billingCycle: billing_cycle }),
      ...(pricing !== undefined && { pricing }),
      ...(currency && { currency }),
      ...(features && { features }),
      ...(max_agents !== undefined && { maxAgents: max_agents }),
      ...(max_customers !== undefined && { maxCustomers: max_customers }),
      ...(max_transactions !== undefined && { maxTransactions: max_transactions }),
      ...(status && { status }),
      ...(description !== undefined && { description }),
      ...(merchantId !== undefined && { merchantId })
    });

    res.json({
      success: true,
      message: "Plan updated successfully",
      data: plan
    });
  } catch (error) {
    console.error("Error updating plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update plan",
      error: error.message
    });
  }
};

const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(422).json({ message: "Plan ID is required" });
    }

    const plan = await Plan.findByPk(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    await plan.destroy();

    res.json({
      success: true,
      message: "Plan deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting plan:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete plan",
      error: error.message
    });
  }
};

const createRole = async (req, res) => {
  try {
    const { name, permissions } = req.body;

    if (!name) return res.status(422).json({ message: "Role name is required" });

    // validate permissions
    if (permissions && !permissions.every(p => PERMISSIONS.includes(p))) {
      return res.status(422).json({ message: "One or more permissions are invalid" });
    }

    const role = await AdminRole.create({ name, permissions });
    res.status(201).json({ success: true, message: "Role created successfully", data: role });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({ success: false, message: "Failed to create role", error: error.message });
  }
};


const getAllPermissions = async (req, res) => {
  res.json({ success: true, data: PERMISSIONS });
};

const getAllRoles = async (req, res) => {
  try {
    const roles = await AdminRole.findAll({ 
      order: [["createdAt", "DESC"]] 
    });
    
    res.json({ success: true, count: roles.length, data: roles });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({ success: false, message: "Failed to fetch roles", error: error.message });
  }
};

const createAdminStaff = async (req, res) => {
  try {
    const { name, email, phoneNumber, password, roleId } = req.body;

    const requiredFields = ["name", "email", "phoneNumber", "password", "roleId"];
    for (let field of requiredFields) {
      if (!req.body[field]) {
        return res.status(422).json({ message: `${field} is required` });
      }
    }

    // check if role exists
    const role = await AdminRole.findByPk(roleId);
    if (!role) return res.status(404).json({ message: "Invalid role ID" });

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const staff = await AdminStaff.create({
      name,
      email,
      phoneNumber,
      password: hashedPassword,
      roleId,
      status: "active",
    });

    res.status(201).json({ success: true, message: "Admin staff created successfully", data: staff });
  } catch (error) {
    console.error("Error creating admin staff:", error);
    res.status(500).json({ success: false, message: "Failed to create admin staff", error: error.message });
  }
};

const getAllAdminStaff = async (req, res) => {
  try {
    const staff = await AdminStaff.findAll({
      include: [{
        model: AdminRole,
        attributes: ['id', 'name']
      }],
      order: [["createdAt", "DESC"]],
    });

    res.json({ success: true, count: staff.length, data: staff });
  } catch (error) {
    console.error("Error fetching admin staff:", error);
    res.status(500).json({ success: false, message: "Failed to fetch admin staff", error: error.message });
  }
};

const getAllAdminLogs = async (req, res) => {
  try {
    // Use Activity model instead of AdminLog
    const { Activity } = require('../models');
    
    const logs = await Activity.findAll({
      where: {
        person: 'staff' // Filter for staff activities
      },
      order: [['date', 'DESC']],
      limit: 100 // Limit to recent 100 logs
    });

    // Format to match expected structure
    const formattedLogs = logs.map(log => ({
      id: log.id,
      adminStaffId: log.staffId,
      action: log.action,
      details: log.details,
      ipAddress: null,
      userAgent: null,
      createdAt: log.date || log.createdAt,
      updatedAt: log.updatedAt,
      AdminStaff: {
        id: log.staffId,
        name: 'Staff Member',
        email: 'N/A',
        role: 'Admin'
      }
    }));

    res.json({
      success: true,
      count: formattedLogs.length,
      data: formattedLogs,
    });
  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin logs',
      error: error.message,
    });
  }
};

const getAdminLogsByStaff = async (req, res) => {
  try {
    const { staffId } = req.params;
    if (!staffId) {
      return res.status(422).json({ message: "staffId is required" });
    }

    const logs = await AdminLogService.getLogsByStaff(staffId);
    res.json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error('Error fetching logs for staff:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs for staff',
      error: error.message,
    });
  }
};


const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions } = req.body;

    if (!id) return res.status(422).json({ message: "Role ID is required" });

    const role = await AdminRole.findByPk(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    // validate permissions if provided
    if (permissions && !permissions.every(p => PERMISSIONS.includes(p))) {
      return res.status(422).json({ message: "One or more permissions are invalid" });
    }

    await role.update({
      ...(name && { name }),
      ...(permissions && { permissions })
    });

    res.json({ success: true, message: "Role updated successfully", data: role });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({ success: false, message: "Failed to update role", error: error.message });
  }
};

const updateAdminStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phoneNumber, roleId } = req.body;

    if (!id) return res.status(422).json({ message: "Staff ID is required" });

    const staff = await AdminStaff.findByPk(id);
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    if (roleId) {
       const role = await AdminRole.findByPk(roleId);
       if (!role) return res.status(404).json({ message: "Invalid role ID" });
    }

    await staff.update({
      ...(name && { name }),
      ...(email && { email }),
      ...(phoneNumber && { phoneNumber }),
      ...(roleId && { roleId })
    });

    res.json({ success: true, message: "Staff updated successfully", data: staff });
  } catch (error) {
    console.error("Error updating admin staff:", error);
    res.status(500).json({ success: false, message: "Failed to update admin staff", error: error.message });
  }
};

const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) return res.status(422).json({ message: "Role ID is required" });

    const role = await AdminRole.findByPk(id);
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    // Prevent deletion of Super Administrator role
    if (role.name === 'Super Administrator') {
        return res.status(403).json({ success: false, message: "Cannot delete Super Administrator role" });
    }

    // Check if any staff is assigned to this role
    const staffCount = await AdminStaff.count({ where: { roleId: id } });
    if (staffCount > 0) {
        return res.status(400).json({ success: false, message: `Cannot delete role because it is assigned to ${staffCount} staff member(s).` });
    }

    await role.destroy();

    res.json({ success: true, message: "Role deleted successfully" });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({ success: false, message: "Failed to delete role", error: error.message });
  }
};

module.exports = {
  loginSuperAdmin,
  getMerchantStats,
  getSuperAdminStats,
  getAllActivities,
  getAllMerchants,
  getAllTransactions,
  createPlan,
  getAllPlans,
  updatePlan,
  deletePlan,
  createRole,
  updateRole,
  deleteRole,
  getAllPermissions,
  getAllRoles,
  createAdminStaff,
  updateAdminStaff,
  getAllAdminStaff,
  getAllAdminLogs,
  getAdminLogsByStaff,
  getAllTickets,
  getTicketDetails,
  replyToTicket,
  updateTicketStatus,
  getAllAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  getAllFaqs,
  createFaq,
  deleteFaq
};

