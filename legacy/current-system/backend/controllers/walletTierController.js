const { WalletTier } = require('../models');

/**
 * @swagger
 * tags:
 *   - name: WalletTiers
 *     description: Wallet Verification Tiers management
 */

// Create wallet tier
const createTier = async (req, res) => {
  try {
    const { level, name, dailyLimit, maxBalance, fee, requirements } = req.body;

    // Check if level already exists
    const existingTier = await WalletTier.findOne({ where: { level } });
    if (existingTier) {
      return res.status(400).json({ message: `Tier level ${level} already exists` });
    }

    // Create tier
    const tier = await WalletTier.create({
      level,
      name,
      dailyLimit,
      maxBalance,
      fee,
      requirements: requirements || [],
    });

    res.status(201).json({
      message: 'Wallet tier created successfully',
      tier,
    });
  } catch (error) {
    console.error('Wallet tier creation error:', error);
    res.status(500).json({ message: 'Wallet tier creation failed', error: error.message });
  }
};

// Update wallet tier
const updateTier = async (req, res) => {
  try {
    const { id, level, name, dailyLimit, maxBalance, fee, requirements } = req.body;

    const tier = await WalletTier.findByPk(id);
    if (!tier) {
      return res.status(404).json({ message: 'Wallet tier not found' });
    }

    // Check if level is being changed and if it's already taken
    if (level && level !== tier.level) {
      const existingTier = await WalletTier.findOne({ where: { level } });
      if (existingTier) {
        return res.status(400).json({ message: `Tier level ${level} already taken` });
      }
    }

    // Update tier
    await tier.update({
      level: level || tier.level,
      name: name || tier.name,
      dailyLimit: dailyLimit !== undefined ? dailyLimit : tier.dailyLimit,
      maxBalance: maxBalance !== undefined ? maxBalance : tier.maxBalance,
      fee: fee !== undefined ? fee : tier.fee,
      requirements: requirements || tier.requirements,
    });

    res.json({
      message: 'Wallet tier updated successfully',
      tier,
    });
  } catch (error) {
    console.error('Wallet tier update error:', error);
    res.status(500).json({ message: 'Wallet tier update failed', error: error.message });
  }
};

// List all wallet tiers
const listTiers = async (req, res) => {
  try {
    const tiers = await WalletTier.findAll({
      order: [['level', 'ASC']],
    });

    res.json({
      message: 'Wallet tiers retrieved successfully',
      tiers,
    });
  } catch (error) {
    console.error('List wallet tiers error:', error);
    res.status(500).json({ message: 'Failed to retrieve wallet tiers', error: error.message });
  }
};

// Get tier by ID
const getTierById = async (req, res) => {
  try {
    const { id } = req.params;
    const tier = await WalletTier.findByPk(id);

    if (!tier) {
      return res.status(404).json({ message: 'Wallet tier not found' });
    }

    res.json({
      message: 'Wallet tier retrieved successfully',
      tier,
    });
  } catch (error) {
    console.error('Get wallet tier error:', error);
    res.status(500).json({ message: 'Failed to retrieve wallet tier', error: error.message });
  }
};

// Delete wallet tier
const deleteTier = async (req, res) => {
  try {
    const { id } = req.params;

    const tier = await WalletTier.findByPk(id);
    if (!tier) {
      return res.status(404).json({ message: 'Wallet tier not found' });
    }

    await tier.destroy();

    res.json({
      message: 'Wallet tier deleted successfully',
    });
  } catch (error) {
    console.error('Delete wallet tier error:', error);
    res.status(500).json({ message: 'Failed to delete wallet tier', error: error.message });
  }
};

module.exports = {
  createTier,
  updateTier,
  listTiers,
  getTierById,
  deleteTier,
};
