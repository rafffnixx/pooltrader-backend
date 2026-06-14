const express = require('express');
const pool = require('../database/pool');

const router = express.Router();

// Test database connection
router.get('/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            success: true,
            message: 'Database connected',
            time: result.rows[0].time
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get all users (public for testing)
router.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, full_name, is_admin, joined_date FROM users');
        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get active pool (checks both status AND dates)
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

// Get all pools with date-based status for dashboard
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
        console.error('Error fetching pools:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get pool by ID with details
router.get('/pool/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get pool details
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
        
        // Get contributions with user names
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
        console.error('Error fetching pool details:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get trades for a pool
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

// Get statistics
router.get('/stats', async (req, res) => {
    try {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const poolCount = await pool.query('SELECT COUNT(*) FROM pools');
        const tradeCount = await pool.query('SELECT COUNT(*) FROM trades');
        const contributionResult = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM contributions');
        const poolTotal = await pool.query('SELECT COALESCE(SUM(current_total), 0) as total FROM pools');
        const activePoolCount = await pool.query(`
            SELECT COUNT(*) FROM pools 
            WHERE status IN ('open', 'active') 
            AND start_date <= CURRENT_TIMESTAMP 
            AND end_date >= CURRENT_TIMESTAMP
        `);
        
        res.json({
            success: true,
            stats: {
                users: parseInt(userCount.rows[0].count),
                pools: parseInt(poolCount.rows[0].count),
                trades: parseInt(tradeCount.rows[0].count),
                totalContributions: parseFloat(contributionResult.rows[0].total),
                totalPoolValue: parseFloat(poolTotal.rows[0].total),
                activePools: parseInt(activePoolCount.rows[0].count)
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

// Get user contributions
router.get('/user/:userId/contributions', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT c.*, p.name as pool_name, p.status as pool_status,
                    p.start_date, p.end_date, p.current_total
             FROM contributions c
             JOIN pools p ON c.pool_id = p.id
             WHERE c.user_id = $1
             ORDER BY c.created_at DESC`,
            [userId]
        );
        
        res.json({
            success: true,
            contributions: result.rows
        });
    } catch (error) {
        console.error('Error fetching user contributions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get user history
router.get('/user/:userId/history', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT c.*, p.name as pool_name, p.status as pool_status,
                    p.start_date, p.end_date, p.current_total
             FROM contributions c
             JOIN pools p ON c.pool_id = p.id
             WHERE c.user_id = $1
             ORDER BY c.created_at DESC`,
            [userId]
        );
        
        res.json({
            success: true,
            contributions: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.full_name, u.email, SUM(c.amount) as total_contributed,
                    COUNT(DISTINCT c.pool_id) as pools_invested
             FROM contributions c
             JOIN users u ON c.user_id = u.id
             GROUP BY u.id, u.full_name, u.email
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

// Get pool contributions (for a specific pool)
router.get('/pool/:poolId/contributions', async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT c.*, u.full_name, u.email
             FROM contributions c
             JOIN users u ON c.user_id = u.id
             WHERE c.pool_id = $1
             ORDER BY c.amount DESC`,
            [poolId]
        );
        
        res.json({
            success: true,
            contributions: result.rows
        });
    } catch (error) {
        console.error('Error fetching pool contributions:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;
