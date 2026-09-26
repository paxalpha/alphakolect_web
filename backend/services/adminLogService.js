const { AdminLog, AdminStaff, AdminRole } = require('../models');

class AdminLogService {
  /**
   * Create a new admin log entry
   * @param {Object} logData - The log data
   * @param {number} logData.staffId - The admin staff ID
   * @param {string} logData.action - The action performed
   * @param {string} logData.entity - The entity type affected
   * @param {number} logData.entityId - The entity ID
   * @param {string} logData.details - Additional details
   * @param {string} logData.ipAddress - IP address
   * @param {string} logData.userAgent - User agent string
   * @param {Object} logData.metadata - Additional metadata
   */
  static async createLog(logData) {
    try {
      const log = await AdminLog.create(logData);
      return log;
    } catch (error) {
      console.error('Error creating admin log:', error);
      throw error;
    }
  }

  /**
   * Get all admin logs with staff details
   */
  static async getAllLogs() {
    try {
      const logs = await AdminLog.findAll({
        include: [
          {
            model: AdminStaff,
            as: 'staff',
            attributes: ['id', 'name', 'email'],
            include: [
              {
                model: AdminRole,
                as: 'role',
                attributes: ['id', 'name']
              }
            ]
          }
        ],
        order: [['createdAt', 'DESC']]
      });
      return logs;
    } catch (error) {
      console.error('Error fetching admin logs:', error);
      throw error;
    }
  }

  /**
   * Get logs for a specific staff member
   * @param {number} staffId - The staff ID
   */
  static async getLogsByStaff(staffId) {
    try {
      const logs = await AdminLog.findAll({
        where: { staffId },
        include: [
          {
            model: AdminStaff,
            as: 'staff',
            attributes: ['id', 'name', 'email']
          }
        ],
        order: [['createdAt', 'DESC']]
      });
      return logs;
    } catch (error) {
      console.error('Error fetching logs for staff:', error);
      throw error;
    }
  }

  /**
   * Get logs by entity
   * @param {string} entity - The entity type
   * @param {number} entityId - The entity ID
   */
  static async getLogsByEntity(entity, entityId) {
    try {
      const logs = await AdminLog.findAll({
        where: { entity, entityId },
        include: [
          {
            model: AdminStaff,
            as: 'staff',
            attributes: ['id', 'name', 'email']
          }
        ],
        order: [['createdAt', 'DESC']]
      });
      return logs;
    } catch (error) {
      console.error('Error fetching logs by entity:', error);
      throw error;
    }
  }
}

module.exports = AdminLogService;
