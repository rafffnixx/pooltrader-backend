const express = require('express');
const pool = require('../../database/pool');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all pools
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, 
                    COUNT(DISTINCT c.user_id) as member_count,
                    COUNT(DISTINCT t.id) as trade_count
             FROM pools p
             LEFT JOIN contributions c ON p.id = c.pool_id
             LEFT JOIN trades t ON p.id = t.pool_id
             GROUP BY p.id
             ORDER BY p.created_at DESC`
        );
        
        res.json({
            success: true,
            pools: result.rows
        });
    } catch (error) {
        console.error('Error fetching pools:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pools'
        });
    }
});

// Get active pool
router.get('/active', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM pools 
             WHERE status IN ('open', 'active') 
             ORDER BY created_at DESC 
             LIMIT 1`
        );
        
        if (result.rows.length === 0) {
            return res.json({
                success: true,
                activePool: null,
                message: 'No active pool at the moment'
            });
        }
        
        res.json({
            success: true,
            activePool: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching active pool:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching active pool'
        });
    }
});

// Get pool by ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT p.*, 
                    COUNT(DISTINCT c.user_id) as member_count,
                    SUM(c.amount) as total_contributions
             FROM pools p
             LEFT JOIN contributions c ON p.id = c.pool_id
             WHERE p.id = $1
             GROUP BY p.id`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pool not found'
            });
        }
        
        res.json({
            success: true,
            pool: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching pool:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pool'
        });
    }
});

// Create new pool (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    const {
        name,
        description,
        startDate,
        endDate,
        totalTarget,
        minContribution,
        maxContribution,
        managerFeePercent
    } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO pools (
                name, description, start_date, end_date, 
                total_target, min_contribution, max_contribution, 
                manager_fee_percent, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
             RETURNING *`,
            [name, description, startDate, endDate, totalTarget, 
             minContribution || 500, maxContribution || 20000, 
             managerFeePercent || 20]
        );
        
        res.status(201).json({
            success: true,
            message: 'Pool created successfully',
            pool: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating pool:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating pool'
        });
    }
});

// Update pool status (admin only)
router.patch('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['open', 'active', 'closed', 'settled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid status'
        });
    }
    
    try {
        const result = await pool.query(
            `UPDATE pools SET status = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 RETURNING *`,
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pool not found'
            });
        }
        
        res.json({
            success: true,
            message: `Pool status updated to ${status}`,
            pool: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating pool status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating pool status'
        });
    }
});

module.exports = router;