const express = require('express');
const pool = require('../database/pool');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// Calculate and distribute profits for a pool
router.post('/calculate/:poolId', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    const { total_profit, management_fee_percent } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get pool details
        const poolResult = await client.query('SELECT * FROM pools WHERE id = $1', [poolId]);
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pool not found' });
        }
        
        const pool = poolResult.rows[0];
        const feePercent = management_fee_percent || parseFloat(pool.manager_fee_percent) || 20;
        
        // Get all contributions for this pool
        const contributions = await client.query(`
            SELECT c.*, u.email, u.full_name, u.current_balance as user_balance
            FROM contributions c
            JOIN users u ON c.user_id = u.id
            WHERE c.pool_id = $1 AND c.status = 'confirmed'
        `, [poolId]);
        
        if (contributions.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No contributions found for this pool' });
        }
        
        // Calculate total pool size
        const totalPool = contributions.rows.reduce((sum, c) => sum + parseFloat(c.amount), 0);
        
        let totalProfitDistributed = 0;
        let totalManagerFee = 0;
        const profitDistributions = [];
        
        for (const contribution of contributions.rows) {
            const userShare = parseFloat(contribution.amount) / totalPool;
            let userProfit = total_profit * userShare;
            let managerFee = 0;
            
            if (total_profit > 0) {
                managerFee = userProfit * (feePercent / 100);
                userProfit = userProfit - managerFee;
            }
            
            totalProfitDistributed += userProfit;
            totalManagerFee += managerFee;
            
            // Update user balance
            const newBalance = parseFloat(contribution.user_balance) + userProfit;
            
            await client.query(`
                UPDATE users 
                SET current_balance = $1 
                WHERE id = $2
            `, [newBalance, contribution.user_id]);
            
            // Record profit split
            const splitResult = await client.query(`
                INSERT INTO profit_loss_splits (pool_id, user_id, original_contribution, final_balance, profit_share, manager_fee, percentage_share)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [poolId, contribution.user_id, contribution.amount, newBalance, userProfit, managerFee, userShare * 100]);
            
            profitDistributions.push({
                user: contribution.full_name,
                email: contribution.email,
                originalContribution: contribution.amount,
                profitShare: userProfit,
                managerFee: managerFee,
                newBalance: newBalance,
                percentageShare: (userShare * 100).toFixed(2)
            });
        }
        
        // Update pool with total profit/loss
        await client.query(`
            UPDATE pools 
            SET total_profit_loss = total_profit_loss + $1,
                total_manager_fee = total_manager_fee + $2,
                last_profit_distribution = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [total_profit, totalManagerFee, poolId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `Profits distributed successfully! Total profit: $${total_profit.toLocaleString()}, Manager fee: $${totalManagerFee.toLocaleString()}`,
            summary: {
                totalProfit: total_profit,
                totalManagerFee: totalManagerFee,
                totalDistributed: totalProfitDistributed,
                usersAffected: contributions.rows.length,
                distributions: profitDistributions
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Profit calculation error:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// Get profit history for a pool
router.get('/history/:poolId', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT ps.*, u.full_name, u.email
            FROM profit_loss_splits ps
            JOIN users u ON ps.user_id = u.id
            WHERE ps.pool_id = $1
            ORDER BY ps.created_at DESC
        `, [poolId]);
        
        res.json({
            success: true,
            distributions: result.rows
        });
    } catch (error) {
        console.error('Error fetching profit history:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get overall platform profit stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COALESCE(SUM(total_profit_loss), 0) as total_profit_loss,
                COALESCE(SUM(total_manager_fee), 0) as total_manager_fee,
                COUNT(DISTINCT id) as pools_affected
            FROM pools
        `);
        
        const userProfits = await pool.query(`
            SELECT 
                COALESCE(SUM(profit_share), 0) as total_user_profits,
                COALESCE(SUM(manager_fee), 0) as total_manager_fees
            FROM profit_loss_splits
        `);
        
        res.json({
            success: true,
            stats: {
                platform: result.rows[0],
                userProfits: userProfits.rows[0]
            }
        });
    } catch (error) {
        console.error('Error fetching profit stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Manual profit entry (admin enters profit made)
router.post('/manual', authMiddleware, adminMiddleware, async (req, res) => {
    const { pool_id, total_profit, description } = req.body;
    
    try {
        // Update pool total profit
        await pool.query(`
            UPDATE pools 
            SET total_profit_loss = total_profit_loss + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [total_profit, pool_id]);
        
        // Log the profit entry
        await pool.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
            VALUES ($1, $2, $3, $4, $5)
        `, [req.user.id, 'PROFIT_ENTERED', 'pool', pool_id, JSON.stringify({ total_profit, description })]);
        
        res.json({
            success: true,
            message: `Profit of $${total_profit.toLocaleString()} recorded for the pool`
        });
    } catch (error) {
        console.error('Error recording profit:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
