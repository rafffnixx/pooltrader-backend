const express = require('express');
const pool = require('../database/pool');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const bcrypt = require('bcryptjs');

const router = express.Router();

// ==================== USER MANAGEMENT ====================

// Get all users
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, email, full_name, is_admin, current_balance, 
                   total_deposited, total_withdrawn, joined_date 
            FROM users 
            ORDER BY joined_date DESC
        `);
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get user details with transactions
router.get('/user-details/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    const { userId } = req.params;
    try {
        const userResult = await pool.query(`
            SELECT id, email, full_name, is_admin, current_balance, 
                   total_deposited, total_withdrawn, joined_date 
            FROM users WHERE id = $1
        `, [userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const transactions = await pool.query(`
            SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
        `, [userId]);
        
        res.json({ success: true, user: userResult.rows[0], transactions: transactions.rows });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reset user password
router.post('/reset-user-password/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    const { userId } = req.params;
    const { newPassword } = req.body;
    
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== TRANSACTION MANAGEMENT ====================

// Get all transactions
router.get('/transactions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, u.full_name as user_name, u.email as user_email
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            ORDER BY t.created_at DESC
        `);
        res.json({ success: true, transactions: result.rows });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Record deposit request (pending)
router.post('/deposit-request', authMiddleware, adminMiddleware, async (req, res) => {
    const { user_id, amount, payment_method, reference_number, admin_notes } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO transactions (user_id, type, amount, status, payment_method, reference_number, admin_notes)
            VALUES ($1, 'deposit', $2, 'pending', $3, $4, $5)
            RETURNING *
        `, [user_id, amount, payment_method, reference_number, admin_notes]);
        
        res.json({ success: true, message: 'Deposit request recorded', transaction: result.rows[0] });
    } catch (error) {
        console.error('Error recording deposit:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update transaction status (verify/reject deposit)
router.put('/transaction/:transactionId/status', authMiddleware, adminMiddleware, async (req, res) => {
    const { transactionId } = req.params;
    const { status } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const transaction = await client.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
        if (transaction.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        const trans = transaction.rows[0];
        
        await client.query('UPDATE transactions SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2', [status, transactionId]);
        
        if (status === 'completed' && trans.type === 'deposit') {
            await client.query(`
                UPDATE users 
                SET current_balance = current_balance + $1,
                    total_deposited = total_deposited + $1
                WHERE id = $2
            `, [trans.amount, trans.user_id]);
        }
        
        await client.query('COMMIT');
        
        res.json({ success: true, message: `Transaction ${status === 'completed' ? 'verified' : 'rejected'} successfully` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating transaction:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== WITHDRAWAL MANAGEMENT ====================

// Get all withdrawal requests
router.get('/withdrawals', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, u.full_name as user_name, u.email as user_email
            FROM withdrawal_requests w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.request_date DESC
        `);
        res.json({ success: true, withdrawals: result.rows });
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Process withdrawal (approve/reject)
router.post('/process-withdrawal/:withdrawalId', authMiddleware, adminMiddleware, async (req, res) => {
    const { withdrawalId } = req.params;
    const { action, admin_notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const withdrawal = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
        if (withdrawal.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Withdrawal not found' });
        }
        
        const wd = withdrawal.rows[0];
        
        if (action === 'approve') {
            const userBalance = await client.query('SELECT current_balance FROM users WHERE id = $1', [wd.user_id]);
            const currentBalance = parseFloat(userBalance.rows[0].current_balance);
            
            if (currentBalance < parseFloat(wd.amount)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Insufficient balance' });
            }
            
            await client.query(`
                UPDATE users 
                SET current_balance = current_balance - $1,
                    total_withdrawn = total_withdrawn + $1
                WHERE id = $2
            `, [wd.amount, wd.user_id]);
            
            await client.query(`
                UPDATE withdrawal_requests 
                SET status = 'approved', processed_date = CURRENT_TIMESTAMP, notes = $1
                WHERE id = $2
            `, [admin_notes, withdrawalId]);
            
            await client.query(`
                INSERT INTO transactions (user_id, type, amount, status, reference_number)
                VALUES ($1, 'withdrawal', $2, 'completed', $3)
            `, [wd.user_id, wd.amount, `WD-${withdrawalId}`]);
            
        } else if (action === 'reject') {
            await client.query(`
                UPDATE withdrawal_requests 
                SET status = 'rejected', processed_date = CURRENT_TIMESTAMP, notes = $1
                WHERE id = $2
            `, [admin_notes, withdrawalId]);
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: `Withdrawal ${action}d successfully` });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing withdrawal:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== POOL MANAGEMENT ====================

// Get all pools
router.get('/pools', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, 
                   COUNT(DISTINCT c.user_id) as member_count,
                   COALESCE(SUM(c.amount), 0) as total_raised
            FROM pools p
            LEFT JOIN contributions c ON p.id = c.pool_id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `);
        res.json({ success: true, pools: result.rows });
    } catch (error) {
        console.error('Error fetching pools:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create new pool
router.post('/create-pool', authMiddleware, adminMiddleware, async (req, res) => {
    const { name, description, start_date, end_date, total_target, min_contribution, max_contribution, manager_fee_percent } = req.body;
    
    try {
        const result = await pool.query(`
            INSERT INTO pools (name, description, start_date, end_date, total_target, min_contribution, max_contribution, manager_fee_percent, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
            RETURNING *
        `, [name, description, start_date, end_date, total_target, min_contribution, max_contribution, manager_fee_percent]);
        
        res.json({ success: true, message: 'Pool created successfully', pool: result.rows[0] });
    } catch (error) {
        console.error('Error creating pool:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== TRADE MANAGEMENT (ADMIN) ====================

// Get all trades (for admin trades tab)
router.get('/trades', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as pool_name
            FROM trades t
            JOIN pools p ON t.pool_id = p.id
            ORDER BY t.open_time DESC
            LIMIT 100
        `);
        res.json({ success: true, trades: result.rows });
    } catch (error) {
        console.error('Error fetching all trades:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get open positions (all pools)
router.get('/open-positions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as pool_name
            FROM trades t
            JOIN pools p ON t.pool_id = p.id
            WHERE t.status = 'open'
            ORDER BY t.open_time DESC
        `);
        
        const positions = result.rows.map(trade => ({
            ...trade,
            current_pnl: trade.current_pnl || 0,
            pnl_percentage: trade.pnl_percentage || 0
        }));
        
        res.json({ success: true, positions });
    } catch (error) {
        console.error('Error fetching open positions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Close a pool and distribute remaining balance
router.post('/pools/:poolId/close', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const poolResult = await client.query('SELECT * FROM pools WHERE id = $1', [poolId]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pool not found' });
        }
        
        const pool = poolResult.rows[0];
        
        const contributions = await client.query(`
            SELECT c.*, u.id as user_id, u.current_balance as user_balance
            FROM contributions c
            JOIN users u ON c.user_id = u.id
            WHERE c.pool_id = $1 AND c.status = 'confirmed'
        `, [poolId]);
        
        if (contributions.rows.length > 0) {
            const totalPool = parseFloat(pool.current_total);
            
            for (const contribution of contributions.rows) {
                const userShare = parseFloat(contribution.amount) / totalPool;
                const userPayout = totalPool * userShare;
                
                await client.query(`
                    UPDATE users 
                    SET current_balance = current_balance + $1
                    WHERE id = $2
                `, [userPayout, contribution.user_id]);
                
                await client.query(`
                    INSERT INTO profit_loss_splits (pool_id, user_id, original_contribution, final_balance, profit_share)
                    VALUES ($1, $2, $3, $4, $5)
                `, [poolId, contribution.user_id, contribution.amount, userPayout, userPayout - parseFloat(contribution.amount)]);
            }
        }
        
        await client.query(`
            UPDATE trades 
            SET status = 'closed', close_time = CURRENT_TIMESTAMP
            WHERE pool_id = $1 AND status = 'open'
        `, [poolId]);
        
        await client.query(`
            UPDATE pools 
            SET status = 'closed', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [poolId]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Pool "${pool.name}" has been closed and funds distributed to ${contributions.rows.length} investors`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error closing pool:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== DASHBOARD ANALYTICS ====================

// Get dashboard analytics
router.get('/analytics', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const totalContributions = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM contributions');
        const pendingWithdrawals = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status = $1', ['pending']);
        
        const activePool = await pool.query(`
            SELECT * FROM pools 
            WHERE status IN ('open', 'active') 
            AND start_date <= CURRENT_TIMESTAMP 
            AND end_date >= CURRENT_TIMESTAMP 
            LIMIT 1
        `);
        
        let poolProgress = null;
        if (activePool.rows.length > 0) {
            poolProgress = {
                current: parseFloat(activePool.rows[0].current_total),
                total: parseFloat(activePool.rows[0].total_target),
                percentage: (parseFloat(activePool.rows[0].current_total) / parseFloat(activePool.rows[0].total_target)) * 100
            };
        }
        
        const topContributors = await pool.query(`
            SELECT u.full_name, SUM(c.amount) as total_contributed
            FROM contributions c
            JOIN users u ON c.user_id = u.id
            GROUP BY u.id, u.full_name
            ORDER BY total_contributed DESC
            LIMIT 10
        `);
        
        const recentDeposits = await pool.query(`
            SELECT t.*, u.full_name
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.type = 'deposit'
            ORDER BY t.created_at DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            analytics: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                totalContributions: parseFloat(totalContributions.rows[0].total),
                pendingWithdrawals: parseFloat(pendingWithdrawals.rows[0].total),
                poolProgress: poolProgress,
                topContributors: topContributors.rows,
                recentDeposits: recentDeposits.rows
            }
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
