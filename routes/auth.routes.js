const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../database/pool');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// Validation rules
const registerValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('fullName').notEmpty().trim().escape()
];

const loginValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
];

const resetPasswordValidation = [
    body('email').isEmail().normalizeEmail(),
    body('newPassword').isLength({ min: 6 }),
    body('confirmPassword').notEmpty()
];

// Register new user
router.post('/register', registerValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false, 
            errors: errors.array() 
        });
    }

    const { email, password, fullName } = req.body;

    try {
        const userExists = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO users (email, password_hash, full_name) 
             VALUES ($1, $2, $3) 
             RETURNING id, email, full_name, is_admin, joined_date`,
            [email.toLowerCase(), passwordHash, fullName]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                isAdmin: user.is_admin,
                fullName: user.full_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [user.id, 'USER_REGISTERED', JSON.stringify({ email: user.email }), req.ip]
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                isAdmin: user.is_admin,
                joinedDate: user.joined_date
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// Login user
router.post('/login', loginValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false, 
            errors: errors.array() 
        });
    }

    const { email, password } = req.body;

    try {
        const result = await pool.query(
            `SELECT id, email, password_hash, full_name, is_admin, 
                    total_deposited, total_withdrawn, current_balance 
             FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const user = result.rows[0];

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                isAdmin: user.is_admin,
                fullName: user.full_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [user.id, 'USER_LOGIN', JSON.stringify({ email: user.email }), req.ip]
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                isAdmin: user.is_admin,
                totalDeposited: parseFloat(user.total_deposited),
                totalWithdrawn: parseFloat(user.total_withdrawn),
                currentBalance: parseFloat(user.current_balance)
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});

// ==================== PASSWORD RESET ENDPOINTS ====================

// Request password reset (sends reset token - email integration would go here)
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        const userExists = await pool.query(
            'SELECT id, email FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (userExists.rows.length === 0) {
            // Don't reveal that user doesn't exist for security
            return res.json({
                success: true,
                message: 'If an account exists with that email, you will receive reset instructions.'
            });
        }

        const user = userExists.rows[0];
        
        // Generate reset token (expires in 1 hour)
        const resetToken = jwt.sign(
            { id: user.id, email: user.email, purpose: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        // Store reset token in database (optional, for extra security)
        await pool.query(
            `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour'
             WHERE id = $2`,
            [resetToken, user.id]
        );
        
        // In production, send email with reset link
        // For now, return the token (in development)
        console.log(`Reset token for ${email}: ${resetToken}`);
        
        res.json({
            success: true,
            message: 'Password reset instructions sent to your email.',
            // Only include token in development
            ...(process.env.NODE_ENV === 'development' && { resetToken })
        });
        
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Reset password using token
router.post('/reset-password', resetPasswordValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false, 
            errors: errors.array() 
        });
    }

    const { token, newPassword, confirmPassword } = req.body;
    
    if (newPassword !== confirmPassword) {
        return res.status(400).json({
            success: false,
            message: 'Passwords do not match'
        });
    }
    
    try {
        // Verify the token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.purpose !== 'password_reset') {
                throw new Error('Invalid token purpose');
            }
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }
        
        // Check if token exists and is not expired in database
        const userCheck = await pool.query(
            `SELECT id FROM users 
             WHERE id = $1 AND reset_token = $2 AND reset_token_expires > NOW()`,
            [decoded.id, token]
        );
        
        if (userCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        
        // Update password and clear reset token
        await pool.query(
            `UPDATE users 
             SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [passwordHash, decoded.id]
        );
        
        // Log password reset
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [decoded.id, 'PASSWORD_RESET', JSON.stringify({}), req.ip]
        );
        
        res.json({
            success: true,
            message: 'Password has been reset successfully. Please login with your new password.'
        });
        
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Change password (authenticated users)
router.post('/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;
    
    if (newPassword !== confirmPassword) {
        return res.status(400).json({
            success: false,
            message: 'New passwords do not match'
        });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }
    
    try {
        // Get current user with password hash
        const result = await pool.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);
        
        // Update password
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newPasswordHash, userId]
        );
        
        // Log password change
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [userId, 'PASSWORD_CHANGED', JSON.stringify({}), req.ip]
        );
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
        
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Admin: Reset any user's password (admin only)
router.post('/admin/reset-user-password/:userId', authMiddleware, async (req, res) => {
    const { userId } = req.params;
    const { newPassword } = req.body;
    
    // Check if requester is admin
    if (!req.user.isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [passwordHash, userId]
        );
        
        // Log admin password reset
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, 'ADMIN_PASSWORD_RESET', JSON.stringify({ targetUserId: userId }), req.ip]
        );
        
        res.json({
            success: true,
            message: 'User password has been reset successfully'
        });
        
    } catch (error) {
        console.error('Admin reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Get current user (protected route)
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, full_name, is_admin, total_deposited, 
                    total_withdrawn, current_balance, joined_date 
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = result.rows[0];
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                isAdmin: user.is_admin,
                totalDeposited: parseFloat(user.total_deposited),
                totalWithdrawn: parseFloat(user.total_withdrawn),
                currentBalance: parseFloat(user.current_balance),
                joinedDate: user.joined_date
            }
        });

    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    res.json({
        success: true,
        message: 'Logout successful'
    });
});

// Add reset_token column to users table if not exists
async function ensureResetTokenColumn() {
    try {
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS reset_token TEXT,
            ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP
        `);
        console.log('✅ Reset token columns verified');
    } catch (error) {
        console.log('Note: Reset token columns may already exist');
    }
}

// Run the column check
ensureResetTokenColumn();

module.exports = router;