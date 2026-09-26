module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      const info = await queryInterface.describeTable('wallet_transactions');
      if (!info.transaction_type) {
        await queryInterface.addColumn('wallet_transactions', 'transaction_type', {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Business transaction type (e.g., payment, refund, loan, investment)'
        });
      }
      if (!info.payment_method) {
        await queryInterface.addColumn('wallet_transactions', 'payment_method', {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Payment method used (Cash, Bank Transfer, POS, etc.)'
        });
      }
    } catch (error) {
      console.error('Error adding transaction_type column to wallet_transactions:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeColumn('wallet_transactions', 'transaction_type');
      await queryInterface.removeColumn('wallet_transactions', 'payment_method');
    } catch (error) {
      console.error('Error removing transaction_type column from wallet_transactions:', error);
      throw error;
    }
  }
};


