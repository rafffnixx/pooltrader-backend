const express = require('express');
const pool = require('../database/pool');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all trades for a specific pool
router.get('/pool/:poolId/trades', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as pool_name
            FROM trades t
            JOIN pools p ON t.pool_id = p.id
            WHERE t.pool_id = $1
            ORDER BY t.open_time DESC
        `, [poolId]);
        
        res.json({ success: true, trades: result.rows });
    } catch (error) {
        console.error('Error fetching trades:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get open positions for a pool
router.get('/pool/:poolId/positions', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as pool_name
            FROM trades t
            JOIN pools p ON t.pool_id = p.id
            WHERE t.pool_id = $1 AND t.status = 'open'
            ORDER BY t.open_time DESC
        `, [poolId]);
        
        const positions = result.rows.map(trade => ({
            ...trade,
            current_pnl: trade.current_pnl || 0,
            pnl_percentage: trade.pnl_percentage || 0
        }));
        
        res.json({ success: true, positions });
    } catch (error) {
        console.error('Error fetching positions:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add new trade - UPDATED with proper volume handling
router.post('/trade', authMiddleware, adminMiddleware, async (req, res) => {
    console.log('📥 FULL REQUEST BODY:', JSON.stringify(req.body, null, 2));
    
    const { 
        pool_id, 
        symbol, 
        direction, 
        volume,        // Can be undefined/null
        lot_size,      // Alternative field name
        open_price, 
        stop_loss, 
        take_profit, 
        entry_amount, 
        stake,         // Alternative field name
        notes,
        open_time
    } = req.body;
    
    // Handle volume - use provided volume, or lot_size, or default to 0
    const finalVolume = volume !== undefined && volume !== null && volume !== '' 
        ? parseFloat(volume) 
        : lot_size !== undefined && lot_size !== null && lot_size !== ''
        ? parseFloat(lot_size)
        : 0;
    
    // Handle stake - use provided entry_amount, or stake, or default to null
    const finalStake = entry_amount !== undefined && entry_amount !== null && entry_amount !== ''
        ? parseFloat(entry_amount)
        : stake !== undefined && stake !== null && stake !== ''
        ? parseFloat(stake)
        : null;
    
    console.log('📥 finalVolume:', finalVolume);
    console.log('📥 finalStake:', finalStake);
    
    try {
        const tradeOpenTime = open_time || new Date().toISOString();
        
        const result = await pool.query(`
            INSERT INTO trades (
                pool_id, 
                symbol, 
                direction, 
                volume, 
                open_price, 
                stop_loss, 
                take_profit, 
                entry_amount,
                notes, 
                open_time,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
            RETURNING *
        `, [
            pool_id, 
            symbol, 
            direction, 
            finalVolume,  // Now always a number (default 0)
            open_price, 
            stop_loss || null, 
            take_profit || null, 
            finalStake, 
            notes || null,
            tradeOpenTime
        ]);
        
        console.log('✅ Trade created with volume:', result.rows[0].volume);
        console.log('✅ Trade created with entry_amount:', result.rows[0].entry_amount);
        console.log('✅ Trade ID:', result.rows[0].id);
        
        res.json({ 
            success: true, 
            message: 'Trade position opened successfully',
            trade: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Add trade error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update trade price (for live tracking)
router.put('/trade/:id/price', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { current_price } = req.body;
    
    try {
        const trade = await pool.query('SELECT * FROM trades WHERE id = $1', [id]);
        if (trade.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trade not found' });
        }
        
        const t = trade.rows[0];
        let currentPnL = 0;
        
        // Use volume or default to 1 to avoid division by zero
        const volume = parseFloat(t.volume) || 1;
        
        if (t.direction === 'BUY') {
            currentPnL = (current_price - parseFloat(t.open_price)) * volume;
        } else {
            currentPnL = (parseFloat(t.open_price) - current_price) * volume;
        }
        
        const pnlPercentage = (currentPnL / (parseFloat(t.open_price) * volume)) * 100;
        
        await pool.query(`
            UPDATE trades 
            SET current_price = $1, current_pnl = $2, pnl_percentage = $3
            WHERE id = $4
        `, [current_price, currentPnL, pnlPercentage, id]);
        
        res.json({ 
            success: true, 
            message: 'Price updated',
            current_pnl: currentPnL,
            pnl_percentage: pnlPercentage
        });
    } catch (error) {
        console.error('Update price error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Close trade with profit/loss - UPDATED
router.post('/trade/:id/close', authMiddleware, adminMiddleware, async (req, res) => {
    console.log('📥 CLOSE REQUEST BODY:', JSON.stringify(req.body, null, 2));
    
    const { id } = req.params;
    const { 
        close_price, 
        closed_reason,
        exit_amount,
        profit_loss,
        close_time
    } = req.body;
    
    try {
        const tradeResult = await pool.query('SELECT * FROM trades WHERE id = $1', [id]);
        if (tradeResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trade not found' });
        }
        
        const trade = tradeResult.rows[0];
        
        // Calculate profit/loss if not manually provided
        let finalProfitLoss = profit_loss;
        if (finalProfitLoss === undefined || finalProfitLoss === null || isNaN(finalProfitLoss)) {
            const volume = parseFloat(trade.volume) || 1;
            if (trade.direction === 'BUY') {
                finalProfitLoss = (close_price - parseFloat(trade.open_price)) * volume;
            } else {
                finalProfitLoss = (parseFloat(trade.open_price) - close_price) * volume;
            }
            console.log('📊 Auto-calculated profit_loss:', finalProfitLoss);
        } else {
            console.log('📊 Using manual profit_loss:', finalProfitLoss);
        }
        
        const tradeCloseTime = close_time || new Date().toISOString();
        
        const result = await pool.query(`
            UPDATE trades 
            SET 
                close_price = $1, 
                profit_loss = $2, 
                status = 'closed',
                close_time = $3,
                closed_reason = $4,
                exit_amount = $5
            WHERE id = $6
            RETURNING *
        `, [
            close_price, 
            finalProfitLoss, 
            tradeCloseTime,
            closed_reason || 'Closed by admin',
            exit_amount || null,
            id
        ]);
        
        await pool.query(`
            UPDATE pools 
            SET total_profit_loss = COALESCE(total_profit_loss, 0) + $1
            WHERE id = $2
        `, [finalProfitLoss, trade.pool_id]);
        
        console.log('✅ Trade closed with exit_amount:', result.rows[0].exit_amount);
        console.log('✅ Trade closed with profit_loss:', result.rows[0].profit_loss);
        
        res.json({ 
            success: true, 
            message: `Trade closed with ${finalProfitLoss >= 0 ? 'profit' : 'loss'} of $${Math.abs(finalProfitLoss).toLocaleString()}`,
            profit_loss: finalProfitLoss,
            trade: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Close trade error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get pool summary
router.get('/pool/:poolId/summary', authMiddleware, adminMiddleware, async (req, res) => {
    const { poolId } = req.params;
    
    try {
        const tradeStats = await pool.query(`
            SELECT 
                COUNT(*) as total_trades,
                COUNT(CASE WHEN status = 'open' THEN 1 END) as open_trades,
                COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_trades,
                COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0) as total_profit,
                COALESCE(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END), 0) as total_loss
            FROM trades WHERE pool_id = $1
        `, [poolId]);
        
        res.json({ 
            success: true, 
            tradeStats: tradeStats.rows[0] || { total_trades: 0, open_trades: 0, closed_trades: 0, total_profit: 0, total_loss: 0 }
        });
    } catch (error) {
        console.error('Error fetching summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;