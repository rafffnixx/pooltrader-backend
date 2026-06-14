const express = require('express');
const pool = require('../../database/pool');
const { authMiddleware } = require('../middleware/auth.middleware');
const emailService = require('../services/email.service');

const router = express.Router();

// Get wallet balance
router.get('/balance', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const userResult = await pool.query(
            'SELECT current_balance as total FROM users WHERE id = $1',
            [userId]
        );
        
        const allocatedResult = await pool.query(`
            SELECT COALESCE(SUM(c.amount), 0) as allocated
            FROM contributions c
            JOIN pools p ON c.pool_id = p.id
            WHERE c.user_id = $1 
            AND c.status = 'confirmed'
            AND p.status IN ('open', 'active')
            AND p.start_date <= CURRENT_TIMESTAMP
            AND p.end_date >= CURRENT_TIMESTAMP
        `, [userId]);
        
        const pendingDeposits = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM transactions 
            WHERE user_id = $1 AND type = 'deposit' AND status = 'pending'
        `, [userId]);
        
        const pendingWithdrawals = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM withdrawal_requests 
            WHERE user_id = $1 AND status = 'pending'
        `, [userId]);
        
        const total = parseFloat(userResult.rows[0]?.total || 0);
        const allocated = parseFloat(allocatedResult.rows[0]?.allocated || 0);
        const withdrawable = total - allocated;
        
        res.json({
            success: true,
            balance: {
                total: total,
                allocated: allocated,
                withdrawable: withdrawable > 0 ? withdrawable : 0,
                pendingDeposits: parseFloat(pendingDeposits.rows[0]?.total || 0),
                pendingWithdrawals: parseFloat(pendingWithdrawals.rows[0]?.total || 0)
            }
        });
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get transactions
router.get('/transactions', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT * FROM transactions 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 50
        `, [userId]);
        
        res.json({ success: true, transactions: result.rows });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get withdrawal requests
router.get('/withdrawals', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT * FROM withdrawal_requests 
            WHERE user_id = $1 
            ORDER BY request_date DESC
        `, [userId]);
        
        res.json({ success: true, withdrawals: result.rows });
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Request deposit
router.post('/deposit-request', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { amount, payment_method, payment_details } = req.body;
    
    if (!amount || amount < 10) {
        return res.status(400).json({ success: false, message: 'Minimum deposit is $10' });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_details)
            VALUES ($1, 'deposit', $2, 'pending', $3, $4)
            RETURNING *
        `, [userId, amount, payment_method, payment_details || null]);
        
        // Get user email for notification
        const userResult = await pool.query(
            'SELECT email, full_name FROM users WHERE id = $1',
            [userId]
        );
        
        // Send deposit request confirmation email
        if (userResult.rows.length > 0) {
            await emailService.sendEmail(userResult.rows[0].email, 'deposit_request', {
                name: userResult.rows[0].full_name.split(' ')[0],
                amount: amount,
                paymentMethod: payment_method,
                transactionId: result.rows[0].id
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Deposit request submitted. Awaiting admin confirmation.',
            transaction: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating deposit request:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Request withdrawal
router.post('/withdraw-request', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { amount, payment_method, payment_details } = req.body;
    
    if (!amount || amount < 10) {
        return res.status(400).json({ success: false, message: 'Minimum withdrawal is $10' });
    }
    
    try {
        const userResult = await pool.query('SELECT current_balance as total, email, full_name FROM users WHERE id = $1', [userId]);
        
        const allocatedResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as allocated
            FROM contributions c
            JOIN pools p ON c.pool_id = p.id
            WHERE c.user_id = $1 AND c.status = 'confirmed'
            AND p.status IN ('open', 'active')
            AND p.start_date <= CURRENT_TIMESTAMP
            AND p.end_date >= CURRENT_TIMESTAMP
        `, [userId]);
        
        const total = parseFloat(userResult.rows[0]?.total || 0);
        const allocated = parseFloat(allocatedResult.rows[0]?.allocated || 0);
        const withdrawable = total - allocated;
        
        if (amount > withdrawable) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient withdrawable balance. Available: $${withdrawable.toLocaleString()}`
            });
        }
        
        const result = await pool.query(`
            INSERT INTO withdrawal_requests (user_id, amount, payment_method, payment_details, status)
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING *
        `, [userId, amount, payment_method, payment_details || null]);
        
        // Send withdrawal request confirmation email
        if (userResult.rows.length > 0) {
            await emailService.sendEmail(userResult.rows[0].email, 'withdrawal_request', {
                name: userResult.rows[0].full_name.split(' ')[0],
                amount: amount,
                paymentMethod: payment_method,
                withdrawalId: result.rows[0].id
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Withdrawal request submitted. Admin will process it shortly.',
            withdrawal: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating withdrawal request:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Allocate funds from wallet to pool
router.post('/allocate-to-pool', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const { pool_id, amount } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const poolResult = await client.query(
            'SELECT * FROM pools WHERE id = $1 AND status = $2',
            [pool_id, 'open']
        );
        
        if (poolResult.rows.length === 0) {
            throw new Error('Pool not found or not open for contributions');
        }
        
        const pool = poolResult.rows[0];
        
        const userResult = await client.query('SELECT current_balance, email, full_name FROM users WHERE id = $1', [userId]);
        const currentBalance = parseFloat(userResult.rows[0].current_balance);
        
        const allocatedResult = await client.query(`
            SELECT COALESCE(SUM(amount), 0) as allocated
            FROM contributions
            WHERE user_id = $1 AND status = 'confirmed'
        `, [userId]);
        
        const allocated = parseFloat(allocatedResult.rows[0].allocated);
        const withdrawable = currentBalance - allocated;
        
        if (amount > withdrawable) {
            throw new Error(`Insufficient withdrawable balance. Available: $${withdrawable.toLocaleString()}`);
        }
        
        const newTotal = parseFloat(pool.current_total) + amount;
        const percentageShare = (amount / newTotal) * 100;
        
        await client.query(`
            INSERT INTO contributions (user_id, pool_id, amount, percentage_share, status, allocated_from_wallet)
            VALUES ($1, $2, $3, $4, 'confirmed', true)
        `, [userId, pool_id, amount, percentageShare]);
        
        await client.query('UPDATE pools SET current_total = $1 WHERE id = $2', [newTotal, pool_id]);
        
        await client.query(`
            INSERT INTO transactions (user_id, type, amount, status, payment_method)
            VALUES ($1, 'allocation', $2, 'completed', 'wallet')
        `, [userId, amount]);
        
        await client.query('COMMIT');
        
        // Send allocation confirmation email
        if (userResult.rows.length > 0) {
            await emailService.sendEmail(userResult.rows[0].email, 'allocation_confirmed', {
                name: userResult.rows[0].full_name.split(' ')[0],
                amount: amount,
                poolName: pool.name,
                poolId: pool_id,
                newBalance: currentBalance - amount,
                dashboardUrl: process.env.CLIENT_URL || 'https://pooltrader.vercel.app/dashboard'
            });
        }
        
        res.json({ 
            success: true, 
            message: `Successfully allocated $${amount.toLocaleString()} to ${pool.name}`,
            newBalance: currentBalance - amount,
            newPoolTotal: newTotal
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error allocating funds:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

module.exports = router;