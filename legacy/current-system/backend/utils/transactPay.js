const forge = require('node-forge');
const fetch = require('node-fetch');

// Read keys lazily at call-time (not module load time) to avoid
// module-caching issues when dotenv runs after first require()
const getPublicKey = () => process.env.TRANSACTPAY_PUBLIC_KEY;
const getSecretKey = () => process.env.TRANSACTPAY_SECRET_KEY;
const getEncryptionKey = () => process.env.TRANSACTPAY_ENCRYPTION_KEY_BASE64;
const TP_BASE_URL = 'https://payment-api-service.transactpay.ai';

// ────────────────────────────────────────────────────────────────────────────
// RSA Encryption (PKCS#1 v1.5) — required for VA creation payload only
// ────────────────────────────────────────────────────────────────────────────
const encryptPayload = (payload) => {
    try {
        const ENCRYPTION_KEY_BASE64 = getEncryptionKey();
        let xmlString = Buffer.from(ENCRYPTION_KEY_BASE64, 'base64').toString('utf8');
        if (xmlString.startsWith('4096!')) {
            xmlString = xmlString.substring(5);
        }
        const modulusMatch = xmlString.match(/<Modulus>(.*?)<\/Modulus>/);
        const exponentMatch = xmlString.match(/<Exponent>(.*?)<\/Exponent>/);
        if (!modulusMatch || !exponentMatch) {
            throw new Error('Invalid RSA XML Key Format');
        }
        const modulusBytes = forge.util.decode64(modulusMatch[1]);
        const exponentBytes = forge.util.decode64(exponentMatch[1]);
        const modulus = new forge.jsbn.BigInteger(forge.util.bytesToHex(modulusBytes), 16);
        const exponent = new forge.jsbn.BigInteger(forge.util.bytesToHex(exponentBytes), 16);
        const publicKey = forge.pki.setRsaPublicKey(modulus, exponent);
        const jsonString = JSON.stringify(payload);
        const encryptedBytes = publicKey.encrypt(jsonString, 'RSAES-PKCS1-V1_5');
        return forge.util.encode64(encryptedBytes);
    } catch (error) {
        console.error('TransactPay Encryption Error:', error.message);
        throw error;
    }
};

// ────────────────────────────────────────────────────────────────────────────
// Create Virtual Account
// Endpoint: POST /payment/virtual-account/generate
// Payload:  { Alias: "merchant-alias" }  — must be RSA-encrypted
// Headers:  api-key, encryption: RSA, Content-Type: application/json
// ────────────────────────────────────────────────────────────────────────────
const createVirtualAccount = async (userData) => {
    try {
        // Use businessAlias as the TransactPay alias, fall back to a generated unique alias
        const alias = userData.alias || userData.businessAlias || userData.Alias || `AK-${Date.now()}`;
        console.log(`[TransactPay] Creating virtual account with alias: ${alias}`);

        const payload = { Alias: alias };
        const encryptedData = encryptPayload(payload);

        const response = await fetch(`${TP_BASE_URL}/payment/virtual-account/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': getPublicKey(),
                'encryption': 'RSA'
            },
            body: JSON.stringify({ data: encryptedData })
        });

        const text = await response.text();
        console.log(`[TransactPay] createVirtualAccount raw response (${response.status}):`, text.substring(0, 500));

        let result;
        try { result = JSON.parse(text); } catch (e) { result = {}; }

        // Handle both response shapes (status: true | "success")
        if (result.status === true || result.status === 'success' || result.message?.toLowerCase().includes('success')) {
            const data = result.data || result;
            return {
                status: 'success',
                alias: alias,
                accountNumber: data.accountNumber || data.account_number,
                bankName: data.bank || data.bankName || data.bank_name,
                accountName: data.accountName || data.account_name,
                bankCode: data.bankCode || data.bank_code,
                data: data
            };
        }

        console.warn('[TransactPay] createVirtualAccount failed:', result.message || JSON.stringify(result));
        return { status: 'failed', message: result.message || 'Unknown error', alias };

    } catch (error) {
        console.error('[TransactPay] createVirtualAccount Error:', error.message);
        return null;
    }
};

// ────────────────────────────────────────────────────────────────────────────
// Get Virtual Account Details by Alias
// Endpoint: GET /payment/account-details?alias={alias}
// Headers:  api-key only — NO encryption required
// ────────────────────────────────────────────────────────────────────────────
const getVirtualAccountDetails = async (alias) => {
    try {
        const response = await fetch(`${TP_BASE_URL}/payment/account-details?alias=${encodeURIComponent(alias)}`, {
            method: 'GET',
            headers: { 'api-key': getSecretKey() }
        });

        const text = await response.text();
        console.log(`[TransactPay] getVirtualAccountDetails (alias=${alias}):`, text.substring(0, 300));

        let result;
        try { result = JSON.parse(text); } catch (e) { return null; }

        if (result.status === true || result.status === 'success') {
            return result.data || result;
        }
        return null;
    } catch (error) {
        console.error('[TransactPay] getVirtualAccountDetails Error:', error.message);
        return null;
    }
};

// ────────────────────────────────────────────────────────────────────────────
// Get Payout / Wallet Balance
// Endpoint: GET /payout/balance-enquiry?currency=NGN
// Headers:  api-key only — NO encryption required
// Returns:  { currency: "NGN", availableBalance: 2463.085 }
// ────────────────────────────────────────────────────────────────────────────
const getWalletBalance = async (currency = 'NGN') => {
    try {
        // TransactPay payout wallet balance supports NGN (and USD), fallback to NGN for others like XOF
        const targetCurrency = (currency === 'USD') ? 'USD' : 'NGN';
        const secretKey = getSecretKey();
        if (!secretKey) {
            console.error('[TransactPay] TRANSACTPAY_SECRET_KEY is not set in environment');
            return null;
        }
        const response = await fetch(`${TP_BASE_URL}/payout/balance-enquiry?currency=${targetCurrency}`, {
            method: 'GET',
            headers: { 'api-key': secretKey }
        });

        const text = await response.text();
        console.log('[TransactPay] getWalletBalance response:', text.substring(0, 300));

        let result;
        try { result = JSON.parse(text); } catch (e) { return null; }

        // Response: { currency, availableBalance }
        if (result.availableBalance !== undefined) {
            return {
                availableBalance: parseFloat(result.availableBalance),
                balance: parseFloat(result.availableBalance),
                currency: result.currency || targetCurrency
            };
        }
        if (result.status === true || result.status === 'success') {
            return result.data || result;
        }
        return null;
    } catch (error) {
        console.error('[TransactPay] getWalletBalance Error:', error.message);
        return null;
    }
};

// ────────────────────────────────────────────────────────────────────────────
// Get Wallet Transactions
// NOTE: TransactPay has no "list all transactions" endpoint.
// Transactions arrive via webhook and are stored locally in WalletTransaction table.
// This function returns an empty array so the controller falls back to the local DB.
// ────────────────────────────────────────────────────────────────────────────
const getWalletTransactions = async (_accountNumber, _page, _limit) => {
    // No TP API endpoint for listing transactions — handled by webhooks → local DB
    return [];
};

// ────────────────────────────────────────────────────────────────────────────
// Get Transaction/Funding Details by sessionId
// Endpoint: GET /payment/transaction-details/{sessionId}
// Headers:  api-key only
// ────────────────────────────────────────────────────────────────────────────
const getTransactionDetails = async (sessionId) => {
    try {
        const response = await fetch(`${TP_BASE_URL}/payment/transaction-details/${sessionId}`, {
            method: 'GET',
            headers: { 'api-key': getPublicKey() }
        });

        const text = await response.text();
        let result;
        try { result = JSON.parse(text); } catch (e) { return null; }

        if (result.status === true || result.status === 'success') {
            return result.data || result;
        }
        return null;
    } catch (error) {
        console.error('[TransactPay] getTransactionDetails Error:', error.message);
        return null;
    }
};

module.exports = {
    encryptPayload,
    createVirtualAccount,
    getVirtualAccountDetails,
    getWalletBalance,
    getWalletTransactions,
    getTransactionDetails
};
