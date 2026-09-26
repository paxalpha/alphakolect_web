'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Support Tickets
    await queryInterface.createTable('support_tickets', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ticket_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      merchant_id: {
        type: Sequelize.INTEGER,
        allowNull: true, // Nullable if created by admin or guest? Assume merchant is usually required.
        references: {
          model: 'merchants',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: false
      },
      category: {
        type: Sequelize.STRING, // Payment, Technical, Transaction, Others
        allowNull: false,
        defaultValue: 'Others'
      },
      priority: {
        type: Sequelize.ENUM('low', 'medium', 'high', 'urgent'),
        defaultValue: 'medium'
      },
      status: {
        type: Sequelize.ENUM('open', 'pending', 'resolved', 'closed'),
        defaultValue: 'open'
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // 2. Ticket Messages
    await queryInterface.createTable('ticket_messages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'support_tickets',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      sender_type: {
        type: Sequelize.ENUM('merchant', 'admin', 'system'),
        allowNull: false
      },
      sender_id: {
        type: Sequelize.INTEGER,
        allowNull: true // ID of merchant or admin staff
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      has_attachment: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      attachment_url: {
        type: Sequelize.STRING,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // 3. Announcements
    await queryInterface.createTable('announcements', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      target_audience: {
        type: Sequelize.ENUM('all', 'merchants', 'agents'),
        defaultValue: 'all'
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true // Admin Staff ID
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // 4. FAQs
    await queryInterface.createTable('faqs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      question: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      answer: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      category: {
        type: Sequelize.STRING,
        defaultValue: 'General'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('faqs');
    await queryInterface.dropTable('announcements');
    await queryInterface.dropTable('ticket_messages');
    await queryInterface.dropTable('support_tickets');
  }
};
