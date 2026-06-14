const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for Render (required for rate limiting behind proxy)
app.set('trust proxy', 1);

// Allowed origins for CORS
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    process.env.CLIENT_URL
].filter(Boolean);

// CORS configuration
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        } else {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 500, // Allow 500 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests: false,
});

// Apply rate limiters to specific routes
app.use('/api/auth/', limiter); // Stricter limit for auth
app.use('/api/admin/', limiter); // Stricter limit for admin
// Public routes have no rate limit

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// Import routes
const authRoutes = require('./routes/auth.routes');
const poolRoutes = require('./routes/pool.routes');
const databaseRoutes = require('./routes/database.routes');
const adminRoutes = require('./routes/admin.routes');
const tradeManagementRoutes = require('./routes/trade-management.routes');
const profitRoutes = require('./routes/profit.routes');
const walletRoutes = require('./routes/wallet.routes');

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api', databaseRoutes);
app.use('/api/admin', adminRoutes);
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
        environment: process.env.NODE_ENV,
        database: 'Connected to PostgreSQL'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Trading Pool Platform API',
        version: '1.0.0',
        status: 'active',
        environment: process.env.NODE_ENV,
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            pools: '/api/pools',
            wallet: '/api/wallet',
            admin: '/api/admin'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    const status = err.status || 500;
    const message = err.message || 'Something went wrong on the server';
    res.status(status).json({
        success: false,
        message: message,
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
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
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📅 Started: ${new Date().toISOString()}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

module.exports = app;