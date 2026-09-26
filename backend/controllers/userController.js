const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Agent } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: Mobile Auth
 *     description: Agent authentication for mobile
 * /api/auth/login:
 *   post:
 *     summary: Agent login
 *     tags: [Mobile Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: 
 *                 type: string
 *                 format: email
 *                 description: Agent email address
 *                 example: "agent@alphaweb.com"
 *               password: 
 *                 type: string
 *                 format: password
 *                 description: Agent password
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 agent:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     fullName:
 *                       type: string
 *                       example: "John Agent"
 *                     email:
 *                       type: string
 *                       example: "agent@alphaweb.com"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Invalid credentials"
 *       500:
 *         description: Login failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Login failed"
 *                 error:
 *                   type: string
 *                   example: "Error details"
 */

// Login agent
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find agent
    const agent = await Agent.findOne({ where: { email } });
    if (!agent) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, agent.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token (include merchantId for scoping)
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    console.log('Creating token with JWT secret:', jwtSecret ? 'Environment variable' : 'Default');
    
    const token = jwt.sign(
      { id: agent.id, email: agent.email, type: 'agent', merchantId: agent.merchantId },
      jwtSecret,
      { expiresIn: '24h' }
    );
    
    console.log('Token created successfully for agent:', agent.email);
    res.json({
      message: 'Login successful',
      token,
      agent: {
        id: agent.id,
        fullName: agent.fullName,
        email: agent.email,
        merchantId: agent.merchantId,
      },
    });
  } catch (error) {
    console.error('User login error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};
module.exports = {
  loginUser,
};

