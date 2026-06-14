const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../database/pool');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// ==================== DASHBOARD & ANALYTICS ====================

// Get complete dashboard analytics
router.get('/analytics', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        // Total stats
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const totalPools = await pool.query('SELECT COUNT(*) FROM pools');
        const totalTrades = await pool.query('SELECT COUNT(*) FROM trades');
        const totalContributions = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM contributions');
        const totalWithdrawals = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status = \'approved\'');
        const pendingWithdrawals = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status = \'pending\'');
        
        // Pool performance
        const activePool = await pool.query(`SELECT * FROM pools WHERE status = 'open' ORDER BY created_at DESC LIMIT 1`);
        const poolProgress = activePool.rows[0] ? {
            total: parseFloat(activePool.rows[0].total_target),
            current: parseFloat(activePool.rows[0].current_total),
            percentage: (parseFloat(activePool.rows[0].current_total) / parseFloat(activePool.rows[0].total_target)) * 100
        } : null;
        
        // Recent activities
        const recentDeposits = await pool.query(`
            SELECT t.*, u.full_name 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.type = 'deposit' 
            ORDER BY t.created_at DESC LIMIT 5
        `);
        
        const recentWithdrawals = await pool.query(`
            SELECT w.*, u.full_name 
            FROM withdrawal_requests w 
            JOIN users u ON w.user_id = u.id 
            ORDER BY w.request_date DESC LIMIT 5
        `);
        
        const recentTrades = await pool.query(`
            SELECT t.*, p.name as pool_name 
            FROM trades t 
            JOIN pools p ON t.pool_id = p.id 
            ORDER BY t.created_at DESC LIMIT 5
        `);
        
        // User analytics
        const topContributors = await pool.query(`
            SELECT u.full_name, u.email, SUM(c.amount) as total_contributed
            FROM contributions c
            JOIN users u ON c.user_id = u.id
            GROUP BY u.id, u.full_name, u.email
            ORDER BY total_contributed DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            analytics: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                totalPools: parseInt(totalPools.rows[0].count),
                totalTrades: parseInt(totalTrades.rows[0].count),
                totalContributions: parseFloat(totalContributions.rows[0].total),
                totalWithdrawals: parseFloat(totalWithdrawals.rows[0].total),
                pendingWithdrawals: parseFloat(pendingWithdrawals.rows[0].total),
                activePool: activePool.rows[0] || null,
                poolProgress: poolProgress,
                recentDeposits: recentDeposits.rows,
                recentWithdrawals: recentWithdrawals.rows,
                recentTrades: recentTrades.rows,
                topContributors: topContributors.rows
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== TRANSACTION MANAGEMENT ====================

// Get all transactions
router.get('/transactions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, u.full_name as user_name, u.email as user_email,
                   a.full_name as processed_by_name
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN users a ON t.processed_by = a.id
            ORDER BY t.created_at DESC
        `);
        res.json({ success: true, transactions: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create deposit transaction (when member sends money)
router.post('/deposit', authMiddleware, adminMiddleware, async (req, res) => {
    const { user_id, amount, payment_method, reference_number, admin_notes } = req.body;
    const admin_id = req.user.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Create transaction record
        const transaction = await client.query(`
            INSERT INTO transactions (user_id, type, amount, status, payment_method, reference_number, admin_notes, processed_by, processed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING *
        `, [user_id, 'deposit', amount, 'completed', payment_method, reference_number, admin_notes, admin_id]);
        
        // Get current user balance
        const userBalance = await client.query('SELECT current_balance FROM users WHERE id = $1', [user_id]);
        const oldBalance = parseFloat(userBalance.rows[0].current_balance);
        const newBalance = oldBalance + parseFloat(amount);
        
        // Update user balance
        await client.query(`
            UPDATE users 
            SET current_balance = $1, total_deposited = total_deposited + $2
            WHERE id = $3
        `, [newBalance, amount, user_id]);
        
        // Record balance change
        await client.query(`
            INSERT INTO user_balances (user_id, previous_balance, new_balance, change_amount, change_type, transaction_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [user_id, oldBalance, newBalance, amount, 'deposit', transaction.rows[0].id]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Deposit of $${amount} recorded for user`,
            transaction: transaction.rows[0],
            new_balance: newBalance
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Deposit error:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// Process withdrawal request
router.post('/process-withdrawal/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { action, admin_notes } = req.body; // action: 'approve' or 'reject'
    const admin_id = req.user.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get withdrawal request
        const withdrawal = await client.query(`
            SELECT * FROM withdrawal_requests WHERE id = $1
        `, [id]);
        
        if (withdrawal.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Withdrawal not found' });
        }
        
        const wd = withdrawal.rows[0];
        
        if (action === 'approve') {
            // Check if user has sufficient balance
            const userBalance = await client.query('SELECT current_balance FROM users WHERE id = $1', [wd.user_id]);
            const currentBalance = parseFloat(userBalance.rows[0].current_balance);
            
            if (currentBalance < parseFloat(wd.amount)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Insufficient balance' });
            }
            
            const newBalance = currentBalance - parseFloat(wd.amount);
            
            // Update user balance
            await client.query(`
                UPDATE users 
                SET current_balance = $1, total_withdrawn = total_withdrawn + $2
                WHERE id = $3
            `, [newBalance, wd.amount, wd.user_id]);
            
            // Update withdrawal status
            await client.query(`
                UPDATE withdrawal_requests 
                SET status = 'approved', processed_date = CURRENT_TIMESTAMP, processed_by = $1, notes = $2
                WHERE id = $3
            `, [admin_id, admin_notes, id]);
            
            // Record balance change
            await client.query(`
                INSERT INTO user_balances (user_id, previous_balance, new_balance, change_amount, change_type)
                VALUES ($1, $2, $3, $4, $5)
            `, [wd.user_id, currentBalance, newBalance, wd.amount, 'withdrawal']);
            
            res.json({ success: true, message: 'Withdrawal approved successfully' });
        } else if (action === 'reject') {
            await client.query(`
                UPDATE withdrawal_requests 
                SET status = 'rejected', processed_date = CURRENT_TIMESTAMP, processed_by = $1, notes = $2
                WHERE id = $3
            `, [admin_id, admin_notes, id]);
            
            res.json({ success: true, message: 'Withdrawal rejected' });
        }
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== PROFIT/LOSS CALCULATION ====================

// Calculate and distribute profits for a pool
router.post('/calculate-profits/:poolId', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    const { total_profit_loss } = req.body; // Positive for profit, negative for loss
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get all contributions for this pool
        const contributions = await client.query(`
            SELECT c.*, u.current_balance as user_balance
            FROM contributions c
            JOIN users u ON c.user_id = u.id
            WHERE c.pool_id = $1 AND c.status = 'confirmed'
        `, [poolId]);
        
        if (contributions.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No contributions found for this pool' });
        }
        
        // Calculate total pool size
        const totalPool = contributions.rows.reduce((sum, c) => sum + parseFloat(c.amount), 0);
        const managerFeePercent = 20; // 20% manager fee
        let totalProfitDistributed = 0;
        
        for (const contribution of contributions.rows) {
            const userShare = parseFloat(contribution.amount) / totalPool;
            let userProfitLoss = total_profit_loss * userShare;
            let managerFee = 0;
            
            if (total_profit_loss > 0) {
                managerFee = userProfitLoss * (managerFeePercent / 100);
                userProfitLoss = userProfitLoss - managerFee;
            }
            
            // Update user balance
            const newBalance = parseFloat(contribution.user_balance) + userProfitLoss;
            
            await client.query(`
                UPDATE users 
                SET current_balance = $1 
                WHERE id = $2
            `, [newBalance, contribution.user_id]);
            
            // Record profit/loss split
            await client.query(`
                INSERT INTO profit_loss_splits (pool_id, user_id, original_contribution, final_balance, profit_share, loss_share, manager_fee, percentage_share)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [poolId, contribution.user_id, contribution.amount, newBalance, 
                total_profit_loss > 0 ? userProfitLoss : 0,
                total_profit_loss < 0 ? userProfitLoss : 0,
                managerFee, userShare * 100]);
            
            totalProfitDistributed += userProfitLoss;
        }
        
        // Update pool status to settled
        await client.query(`
            UPDATE pools 
            SET status = 'settled', total_profit_loss = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [total_profit_loss, poolId]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Profits/losses distributed successfully`,
            total_profit_loss: total_profit_loss,
            users_affected: contributions.rows.length
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Profit calculation error:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== TRADE MANAGEMENT WITH POSITIONS ====================

// Get all open positions
router.get('/open-positions', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as pool_name, p.current_total as pool_value
            FROM trades t
            JOIN pools p ON t.pool_id = p.id
            WHERE t.status = 'open'
            ORDER BY t.open_time DESC
        `);
        
        // Calculate current P&L for each position (simplified)
        const positions = result.rows.map(trade => ({
            ...trade,
            current_pnl: trade.profit_loss || 0,
            pnl_percentage: trade.open_price ? ((trade.close_price || trade.open_price) / trade.open_price - 1) * 100 : 0
        }));
        
        res.json({ success: true, positions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add trade with position details
router.post('/add-trade', authMiddleware, adminMiddleware, async (req, res) => {
    const { pool_id, symbol, direction, volume, open_price, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const result = await client.query(`
            INSERT INTO trades (pool_id, symbol, direction, volume, open_price, status, notes)
            VALUES ($1, $2, $3, $4, $5, 'open', $6)
            RETURNING *
        `, [pool_id, symbol, direction, volume, open_price, notes]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Trade position opened successfully',
            trade: result.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// Close trade position with outcome
router.post('/close-trade/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { close_price, profit_loss, notes } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const result = await client.query(`
            UPDATE trades 
            SET close_price = $1, profit_loss = $2, status = 'closed', 
                close_time = CURRENT_TIMESTAMP, notes = $3
            WHERE id = $4
            RETURNING *
        `, [close_price, profit_loss, notes, id]);
        
        // Update pool's total profit/loss
        await client.query(`
            UPDATE pools 
            SET total_profit_loss = total_profit_loss + $1
            WHERE id = (SELECT pool_id FROM trades WHERE id = $2)
        `, [profit_loss, id]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Trade closed with ${profit_loss >= 0 ? 'profit' : 'loss'} of $${Math.abs(profit_loss)}`,
            trade: result.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// ==================== USER MANAGEMENT WITH BALANCE ====================

// Get user with full details including transaction history
router.get('/user-details/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    
    try {
        const user = await pool.query(`
            SELECT id, email, full_name, is_admin, total_deposited, total_withdrawn, current_balance, joined_date
            FROM users WHERE id = $1
        `, [id]);
        
        const transactions = await pool.query(`
            SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
        `, [id]);
        
        const contributions = await pool.query(`
            SELECT c.*, p.name as pool_name
            FROM contributions c
            JOIN pools p ON c.pool_id = p.id
            WHERE c.user_id = $1
            ORDER BY c.created_at DESC
        `, [id]);
        
        const withdrawals = await pool.query(`
            SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY request_date DESC
        `, [id]);
        
        res.json({
            success: true,
            user: user.rows[0],
            transactions: transactions.rows,
            contributions: contributions.rows,
            withdrawals: withdrawals.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update user balance manually (admin adjustment)
router.post('/adjust-balance', authMiddleware, adminMiddleware, async (req, res) => {
    const { user_id, amount, reason } = req.body;
    const admin_id = req.user.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const userBalance = await client.query('SELECT current_balance FROM users WHERE id = $1', [user_id]);
        const oldBalance = parseFloat(userBalance.rows[0].current_balance);
        const newBalance = oldBalance + parseFloat(amount);
        
        await client.query(`
            UPDATE users SET current_balance = $1 WHERE id = $2
        `, [newBalance, user_id]);
        
        await client.query(`
            INSERT INTO transactions (user_id, type, amount, status, admin_notes, processed_by, processed_at)
            VALUES ($1, 'balance_adjustment', $2, 'completed', $3, $4, CURRENT_TIMESTAMP)
        `, [user_id, Math.abs(amount), `${reason} (Admin adjustment)`, admin_id]);
        
        await client.query(`
            INSERT INTO user_balances (user_id, previous_balance, new_balance, change_amount, change_type)
            VALUES ($1, $2, $3, $4, 'admin_adjustment')
        `, [user_id, oldBalance, newBalance, amount]);
        
        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Balance adjusted by $${amount}`,
            new_balance: newBalance
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

module.exports = router;
