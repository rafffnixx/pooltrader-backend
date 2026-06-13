const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200
}));

// Rate limiting
// Find this section and update the values
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window (changed from 15 minutes)
    max: 500, // Allow 500 requests per minute (increased from 100)
    message: 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests: false, // Don't skip successful requests
});

// Apply rate limiter only to specific routes, not all
// Instead of app.use('/api/', limiter), use:
app.use('/api/auth/', limiter); // Stricter limit for auth
app.use('/api/admin/', limiter); // Stricter limit for admin
// For public routes, use a higher limit or no limit

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// Import routes (only existing ones)
const authRoutes = require('./routes/auth.routes');
const poolRoutes = require('./routes/pool.routes');
const databaseRoutes = require('./routes/database.routes');
const adminRoutes = require('./routes/admin.routes');
const adminCompleteRoutes = require('./routes/admin-complete.routes');
const tradeManagementRoutes = require('./routes/trade-management.routes');
const profitRoutes = require('./routes/profit.routes');
const walletRoutes = require('./routes/wallet.routes');






// API routes
app.use('/api/auth', authRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api', databaseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminCompleteRoutes);
// Add this line
app.use('/api/admin/trade-management', tradeManagementRoutes);
app.use('/api/profits', profitRoutes);
app.use('/api/wallet', walletRoutes);



// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        status: 'OK',
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'Connected to Render PostgreSQL'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Trading Pool Platform API',
        version: '1.0.0',
        status: 'active',
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            pools: '/api/pools',
            database: '/api/database'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    const status = err.status || 500;
    const message = err.message || 'Something went wrong on the server';
    res.status(status).json({
        success: false,
        message: message,
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server is running!`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`📅 Started: ${new Date().toISOString()}\n`);
});

// CORS configuration - update this section
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});

module.exports = app;