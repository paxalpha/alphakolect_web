const { Merchant, Customer, WalletTransaction, CustomerWallet } = require('../models');

const handleTransactPayWebhook = async (req, res) => {
    try {
        const payload = req.body;
        console.log('Incoming TransactPay Webhook:', JSON.stringify(payload, null, 2));

        // Skip processing if it's a test or empty payload
        if (!payload || Object.keys(payload).length === 0) {
            return res.status(200).json({ status: 'success', message: 'Empty payload' });
        }
        
        const event = payload.event || payload.status;
        const data = payload.data || payload; 
        
        // Handle virtual account deposit or successful collection
        if (event === 'virtual_account.deposit' || event === 'collection.success' || data.accountNumber) {
            const accountNumber = data.accountNumber || data.account_number;
            const amount = parseFloat(data.amount);
            const reference = data.reference || data.tx_ref || data.external_reference;

            if (!accountNumber || !amount) {
                console.log('Webhook: Missing accountNumber or amount, skipping');
                return res.status(200).json({ status: 'success', message: 'Incomplete data' });
            }

            // 1. Try to find merchant by account number
            let merchant = await Merchant.findOne({ where: { accountNumber } });
            
            if (merchant) {
                console.log(`Webhook: Processing ${amount} for merchant ${merchant.id}`);
                
                const existingTx = await WalletTransaction.findOne({ where: { reference } });
                if (!existingTx) {
                    await WalletTransaction.create({
                        merchantId: merchant.id,
                        type: 'credit',
                        transactionType: 'credit',
                        category: 'Deposit',
                        amount: amount,
                        description: `Deposit: ${data.narration || data.description || 'TransactPay Payment'}`,
                        reference: reference,
                        status: 'Completed',
                        date: new Date(),
                        paymentMethod: data.payment_method || 'Bank Transfer'
                    });

                    // Book double-entry for webhook wallet deposit
                    try {
                        const { postJournalForTransaction } = require('../utils/transactionMapping');
                        await postJournalForTransaction(
                            'WALLET_DEPOSIT',
                            amount,
                            merchant.id,
                            `Webhook Deposit ref ${reference}`
                        );
                    } catch (deErr) {
                        console.warn('⚠️ Double-entry skipped for webhook deposit:', deErr.message);
                    }
                    console.log(`Webhook: Created transaction record for merchant ${merchant.id}`);
                }
                return res.status(200).json({ status: 'success', message: 'Merchant payment processed' });
            }

            // 2. Try to find customer wallet by account number
            let customerWallet = await CustomerWallet.findOne({ 
                where: { accountNumber },
                include: [{ model: Customer, as: 'customer' }]
            });

            if (customerWallet) {
                console.log(`Webhook: Processing ${amount} for customer ${customerWallet.customerId}`);
                
                // Update customer wallet balance
                const newBalance = parseFloat(customerWallet.balance) + amount;
                await customerWallet.update({
                    balance: newBalance,
                    lastTransactionDate: new Date()
                });
                
                console.log(`Webhook: Updated customer ${customerWallet.customerId} balance to ${newBalance}`);
                return res.status(200).json({ status: 'success', message: 'Customer payment processed' });
            }
        }

        // Catch-all for other events
        console.log(`Webhook: Event '${event}' acknowledged but not specifically handled`);
        res.status(200).json({ status: 'success', message: 'Event acknowledged' });

    } catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to avoid provider retries if it's a code error, 
        // but log it for debugging. Or 500 if you want retries.
        res.status(500).json({ status: 'failed', message: 'Internal processing error' });
    }
};

module.exports = {
    handleTransactPayWebhook
};
