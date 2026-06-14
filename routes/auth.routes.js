const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../database/pool');
const { authMiddleware } = require('../middleware/auth.middleware');
const emailService = require('../services/email.service');  // This should be correct
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
    body('newPassword').isLength({ min: 6 }),
    body('confirmPassword').notEmpty()
];

// Generate email verification code
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Register new user with email verification
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
        
        // Generate verification code
        const verificationCode = generateVerificationCode();
        const verificationExpiry = new Date();
        verificationExpiry.setHours(verificationExpiry.getHours() + 24); // 24 hours expiry

        const result = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, verification_code, verification_expiry, is_verified) 
             VALUES ($1, $2, $3, $4, $5, false) 
             RETURNING id, email, full_name, is_admin, joined_date`,
            [email.toLowerCase(), passwordHash, fullName, verificationCode, verificationExpiry]
        );

        const user = result.rows[0];

        // Send verification email
        const frontendUrl = process.env.CLIENT_URL || 'https://pooltrader.vercel.app';
        const verificationLink = `${frontendUrl}/verify-email/${verificationCode}?email=${encodeURIComponent(email)}`;
        
        await emailService.sendEmail(user.email, 'email_verification', {
            name: user.full_name.split(' ')[0],
            verificationCode: verificationCode,
            verificationLink: verificationLink,
            expiryHours: 24
        });

        // Don't send token until email is verified
        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email to verify your account.',
            requiresVerification: true,
            email: user.email
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// Verify email with code
router.post('/verify-email', async (req, res) => {
    const { email, code } = req.body;
    
    try {
        const result = await pool.query(
            `SELECT id, email, full_name, verification_code, verification_expiry, is_verified 
             FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = result.rows[0];
        
        if (user.is_verified) {
            return res.status(400).json({
                success: false,
                message: 'Email already verified'
            });
        }
        
        if (user.verification_code !== code) {
            return res.status(400).json({
                success: false,
                message: 'Invalid verification code'
            });
        }
        
        if (new Date() > new Date(user.verification_expiry)) {
            return res.status(400).json({
                success: false,
                message: 'Verification code has expired. Please request a new one.'
            });
        }
        
        // Update user as verified
        await pool.query(
            `UPDATE users 
             SET is_verified = true, verification_code = NULL, verification_expiry = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [user.id]
        );
        
        // Generate JWT token
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
        
        // Send welcome email
        await emailService.sendEmail(user.email, 'welcome', {
            name: user.full_name.split(' ')[0],
            dashboardUrl: process.env.CLIENT_URL || 'https://pooltrader.vercel.app/dashboard'
        });
        
        res.json({
            success: true,
            message: 'Email verified successfully!',
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
        console.error('Email verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during verification'
        });
    }
});

// Resend verification code
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    
    try {
        const result = await pool.query(
            `SELECT id, email, full_name, is_verified FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = result.rows[0];
        
        if (user.is_verified) {
            return res.status(400).json({
                success: false,
                message: 'Email already verified'
            });
        }
        
        // Generate new verification code
        const verificationCode = generateVerificationCode();
        const verificationExpiry = new Date();
        verificationExpiry.setHours(verificationExpiry.getHours() + 24);
        
        await pool.query(
            `UPDATE users 
             SET verification_code = $1, verification_expiry = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [verificationCode, verificationExpiry, user.id]
        );
        
        // Send verification email
        const frontendUrl = process.env.CLIENT_URL || 'https://pooltrader.vercel.app';
        const verificationLink = `${frontendUrl}/verify-email/${verificationCode}?email=${encodeURIComponent(email)}`;
        
        await emailService.sendEmail(user.email, 'email_verification', {
            name: user.full_name.split(' ')[0],
            verificationCode: verificationCode,
            verificationLink: verificationLink,
            expiryHours: 24
        });
        
        res.json({
            success: true,
            message: 'New verification code sent to your email'
        });
        
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Login user (check if verified)
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
                    total_deposited, total_withdrawn, current_balance, is_verified
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

        // Check if email is verified
        if (!user.is_verified) {
            return res.status(401).json({
                success: false,
                message: 'Please verify your email before logging in. Check your inbox for the verification code.',
                requiresVerification: true,
                email: user.email
            });
        }

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

// Request password reset (sends email with reset link)
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        const userExists = await pool.query(
            'SELECT id, email, full_name FROM users WHERE email = $1',
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
        
        // Store reset token in database
        await pool.query(
            `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour'
             WHERE id = $2`,
            [resetToken, user.id]
        );
        
        // Send email with reset link
        const frontendUrl = process.env.CLIENT_URL || 'https://pooltrader.vercel.app';
        const resetLink = `${frontendUrl}/reset-password/${resetToken}`;
        
        await emailService.sendEmail(user.email, 'password_reset', {
            name: user.full_name.split(' ')[0],
            resetLink: resetLink
        });
        
        res.json({
            success: true,
            message: 'Password reset instructions sent to your email.'
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
        
        // Send confirmation email
        const userResult = await pool.query(
            'SELECT email, full_name FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (userResult.rows.length > 0) {
            await emailService.sendEmail(userResult.rows[0].email, 'password_reset_confirmation', {
                name: userResult.rows[0].full_name.split(' ')[0]
            });
        }
        
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
        const result = await pool.query(
            'SELECT password_hash, email, full_name FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);
        
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newPasswordHash, userId]
        );
        
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [userId, 'PASSWORD_CHANGED', JSON.stringify({}), req.ip]
        );
        
        // Send confirmation email
        await emailService.sendEmail(result.rows[0].email, 'password_changed', {
            name: result.rows[0].full_name.split(' ')[0]
        });
        
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
        
        const userResult = await pool.query(
            'SELECT email, full_name FROM users WHERE id = $1',
            [userId]
        );
        
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [passwordHash, userId]
        );
        
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) 
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, 'ADMIN_PASSWORD_RESET', JSON.stringify({ targetUserId: userId }), req.ip]
        );
        
        // Notify user of password reset
        if (userResult.rows.length > 0) {
            await emailService.sendEmail(userResult.rows[0].email, 'admin_password_reset', {
                name: userResult.rows[0].full_name.split(' ')[0],
                adminName: req.user.fullName
            });
        }
        
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
                    total_withdrawn, current_balance, joined_date, is_verified
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
                joinedDate: user.joined_date,
                isVerified: user.is_verified
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

// Add required columns to users table if not exists
async function ensureColumns() {
    try {
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS reset_token TEXT,
            ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP,
            ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10),
            ADD COLUMN IF NOT EXISTS verification_expiry TIMESTAMP,
            ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false
        `);
        console.log('✅ User table columns verified');
    } catch (error) {
        console.log('Note: Columns may already exist:', error.message);
    }
}

// Run the column check
ensureColumns();

module.exports = router;
