const express = require('express');
const pool = require('../database/pool');

const router = express.Router();

// Health check
router.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            success: true,
            status: 'OK',
            message: 'Server is running',
            timestamp: new Date().toISOString(),
            database: 'Connected',
            dbTime: result.rows[0].time
        });
    } catch (error) {
        res.json({
            success: true,
            status: 'OK',
            message: 'Server is running',
            timestamp: new Date().toISOString(),
            database: 'Error connecting to DB',
            error: error.message
        });
    }
});

// Get all pools (public)
router.get('/pools', async (req, res) => {
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
            message: error.message 
        });
    }
});

// Get all pools with display status (for dashboard) - ADD THIS
router.get('/pools-list', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, 
                    COUNT(DISTINCT c.user_id) as member_count,
                    COUNT(DISTINCT t.id) as trade_count,
                    CASE 
                        WHEN p.status IN ('open', 'active') 
                             AND p.start_date <= CURRENT_TIMESTAMP 
                             AND p.end_date >= CURRENT_TIMESTAMP 
                        THEN 'active'
                        WHEN p.end_date < CURRENT_TIMESTAMP THEN 'expired'
                        WHEN p.start_date > CURRENT_TIMESTAMP THEN 'upcoming'
                        ELSE p.status
                    END as display_status
             FROM pools p
             LEFT JOIN contributions c ON p.id = c.pool_id
             LEFT JOIN trades t ON p.id = t.pool_id
             GROUP BY p.id
             ORDER BY 
                CASE 
                    WHEN p.start_date <= CURRENT_TIMESTAMP AND p.end_date >= CURRENT_TIMESTAMP THEN 1
                    WHEN p.start_date > CURRENT_TIMESTAMP THEN 2
                    ELSE 3
                END,
                p.created_at DESC`
        );
        
        res.json({ 
            success: true, 
            pools: result.rows 
        });
    } catch (error) {
        console.error('Error fetching pools list:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get active pool (checks both status and dates)
router.get('/active-pool', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM pools 
             WHERE status IN ('open', 'active') 
             AND start_date <= CURRENT_TIMESTAMP
             AND end_date >= CURRENT_TIMESTAMP
             ORDER BY created_at DESC 
             LIMIT 1`
        );
        
        if (result.rows.length === 0) {
            return res.json({ 
                success: true, 
                pool: null, 
                message: 'No active pool at the moment' 
            });
        }
        
        res.json({ 
            success: true, 
            pool: result.rows[0] 
        });
    } catch (error) {
        console.error('Error fetching active pool:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get pool by ID (public)
router.get('/pool/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const poolResult = await pool.query(
            'SELECT * FROM pools WHERE id = $1',
            [id]
        );
        
        if (poolResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pool not found' 
            });
        }
        
        // Get contributions
        const contributionsResult = await pool.query(
            `SELECT c.*, u.full_name 
             FROM contributions c
             JOIN users u ON c.user_id = u.id
             WHERE c.pool_id = $1
             ORDER BY c.amount DESC`,
            [id]
        );
        
        // Get trades
        const tradesResult = await pool.query(
            `SELECT * FROM trades 
             WHERE pool_id = $1 
             ORDER BY open_time DESC`,
            [id]
        );
        
        res.json({
            success: true,
            pool: poolResult.rows[0],
            contributions: contributionsResult.rows,
            trades: tradesResult.rows
        });
    } catch (error) {
        console.error('Error fetching pool:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get trades for a pool (public)
router.get('/trades/:poolId', async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM trades 
             WHERE pool_id = $1 
             ORDER BY open_time DESC`,
            [poolId]
        );
        
        res.json({ 
            success: true, 
            trades: result.rows 
        });
    } catch (error) {
        console.error('Error fetching trades:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get statistics (public)
router.get('/stats', async (req, res) => {
    try {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const poolCount = await pool.query('SELECT COUNT(*) FROM pools');
        const tradeCount = await pool.query('SELECT COUNT(*) FROM trades');
        const contributionResult = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM contributions');
        const poolTotal = await pool.query('SELECT COALESCE(SUM(current_total), 0) as total FROM pools');
        
        res.json({
            success: true,
            stats: {
                users: parseInt(userCount.rows[0].count),
                pools: parseInt(poolCount.rows[0].count),
                trades: parseInt(tradeCount.rows[0].count),
                totalContributions: parseFloat(contributionResult.rows[0].total),
                totalPoolValue: parseFloat(poolTotal.rows[0].total)
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get leaderboard (top contributors)
router.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.full_name, SUM(c.amount) as total_contributed
             FROM contributions c
             JOIN users u ON c.user_id = u.id
             GROUP BY u.id, u.full_name
             ORDER BY total_contributed DESC
             LIMIT 10`
        );
        
        res.json({
            success: true,
            leaderboard: result.rows
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get recent trades (public)
router.get('/recent-trades', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, p.name as pool_name
             FROM trades t
             JOIN pools p ON t.pool_id = p.id
             ORDER BY t.open_time DESC
             LIMIT 20`
        );
        
        res.json({
            success: true,
            trades: result.rows
        });
    } catch (error) {
        console.error('Error fetching recent trades:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;
