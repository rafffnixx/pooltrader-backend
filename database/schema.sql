-- ==========================================
-- TRADING POOL PLATFORM DATABASE SCHEMA
-- ==========================================

-- Drop tables if they exist (for clean setup)
DROP TABLE IF EXISTS profit_loss_splits CASCADE;
DROP TABLE IF EXISTS broker_credentials CASCADE;
DROP TABLE IF EXISTS withdrawal_requests CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS contributions CASCADE;
DROP TABLE IF EXISTS pools CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;

-- ==========================================
-- USERS TABLE
-- ==========================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    total_deposited DECIMAL(15,2) DEFAULT 0,
    total_withdrawn DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- POOLS TABLE
-- ==========================================
CREATE TABLE pools (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    total_target DECIMAL(15,2) NOT NULL,
    current_total DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'open', -- open, active, closed, settled
    manager_fee_percent DECIMAL(5,2) DEFAULT 20.00,
    min_contribution DECIMAL(15,2) DEFAULT 500,
    max_contribution DECIMAL(15,2) DEFAULT 20000,
    high_water_mark DECIMAL(15,2) DEFAULT 0,
    total_profit_loss DECIMAL(15,2) DEFAULT 0,
    member_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_dates CHECK (end_date > start_date),
    CONSTRAINT valid_target CHECK (total_target > 0),
    CONSTRAINT valid_contribution_range CHECK (min_contribution <= max_contribution)
);

-- ==========================================
-- CONTRIBUTIONS TABLE
-- ==========================================
CREATE TABLE contributions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    pool_id INTEGER REFERENCES pools(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    percentage_share DECIMAL(10,4),
    contribution_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'confirmed', -- pending, confirmed, refunded
    transaction_hash VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_amount CHECK (amount > 0)
);

-- ==========================================
-- TRADES TABLE
-- ==========================================
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER REFERENCES pools(id) ON DELETE CASCADE,
    broker_ticket_id VARCHAR(255),
    symbol VARCHAR(50) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- BUY, SELL
    volume DECIMAL(15,2) NOT NULL,
    open_price DECIMAL(15,4) NOT NULL,
    close_price DECIMAL(15,4),
    profit_loss DECIMAL(15,2),
    open_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    close_time TIMESTAMP,
    status VARCHAR(50) DEFAULT 'open', -- open, closed
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_direction CHECK (direction IN ('BUY', 'SELL'))
);

-- ==========================================
-- WITHDRAWAL REQUESTS TABLE
-- ==========================================
CREATE TABLE withdrawal_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, completed
    processed_date TIMESTAMP,
    processed_by INTEGER REFERENCES users(id),
    bank_details JSONB,
    transaction_hash VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_withdrawal_amount CHECK (amount > 0)
);

-- ==========================================
-- PROFIT/LOSS SPLITS TABLE
-- ==========================================
CREATE TABLE profit_loss_splits (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER REFERENCES pools(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    original_contribution DECIMAL(15,2) NOT NULL,
    final_balance DECIMAL(15,2),
    profit_share DECIMAL(15,2),
    loss_share DECIMAL(15,2),
    manager_fee DECIMAL(15,2),
    percentage_share DECIMAL(10,4),
    payout_status VARCHAR(50) DEFAULT 'pending', -- pending, paid
    payout_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- BROKER CREDENTIALS TABLE
-- ==========================================
CREATE TABLE broker_credentials (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER REFERENCES pools(id) ON DELETE CASCADE,
    broker_name VARCHAR(255) NOT NULL,
    login_id VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    server VARCHAR(255),
    read_only_url TEXT,
    expiry_date TIMESTAMP,
    last_verified TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- AUDIT LOGS TABLE
-- ==========================================
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- CREATE INDEXES FOR PERFORMANCE
-- ==========================================
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_admin ON users(is_admin);
CREATE INDEX idx_pools_status ON pools(status);
CREATE INDEX idx_pools_dates ON pools(start_date, end_date);
CREATE INDEX idx_contributions_user ON contributions(user_id);
CREATE INDEX idx_contributions_pool ON contributions(pool_id);
CREATE INDEX idx_contributions_user_pool ON contributions(user_id, pool_id);
CREATE INDEX idx_trades_pool ON trades(pool_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_open_time ON trades(open_time);
CREATE INDEX idx_withdrawals_user ON withdrawal_requests(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawal_requests(status);
CREATE INDEX idx_profit_loss_splits_pool ON profit_loss_splits(pool_id);
CREATE INDEX idx_profit_loss_splits_user ON profit_loss_splits(user_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ==========================================
-- CREATE TRIGGER FUNCTIONS
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pools_updated_at BEFORE UPDATE ON pools 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_broker_credentials_updated_at BEFORE UPDATE ON broker_credentials 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- INSERT SAMPLE DATA
-- ==========================================

-- Insert admin user (password: Admin123! - will be hashed by application)
INSERT INTO users (email, password_hash, full_name, is_admin) 
VALUES ('admin@tradingpool.com', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrLbvGjD7Fd9YrJuvUJ2s0wVX5UZqm', 'System Admin', true)
ON CONFLICT (email) DO NOTHING;

-- Insert sample active pool
INSERT INTO pools (name, description, start_date, end_date, total_target, current_total, status, min_contribution, max_contribution)
VALUES (
    'Pool Session #12', 
    'Q1 2024 Trading Session - Focus on Forex and Crypto',
    CURRENT_TIMESTAMP, 
    CURRENT_TIMESTAMP + INTERVAL '30 days', 
    100000, 
    87400, 
    'open',
    500,
    20000
);

-- Insert sample trades
INSERT INTO trades (pool_id, symbol, direction, volume, open_price, status, open_time)
SELECT 
    id,
    'EUR/USD',
    'BUY',
    1.5,
    1.0925,
    'open',
    CURRENT_TIMESTAMP - INTERVAL '2 days'
FROM pools WHERE status = 'open' LIMIT 1;

INSERT INTO trades (pool_id, symbol, direction, volume, open_price, status, open_time)
SELECT 
    id,
    'BTC/USD',
    'SELL',
    0.5,
    43250.00,
    'open',
    CURRENT_TIMESTAMP - INTERVAL '1 day'
FROM pools WHERE status = 'open' LIMIT 1;

INSERT INTO trades (pool_id, symbol, direction, volume, open_price, close_price, profit_loss, status, open_time, close_time)
SELECT 
    id,
    'Gold',
    'BUY',
    10,
    2035.50,
    2048.75,
    132.50,
    'closed',
    CURRENT_TIMESTAMP - INTERVAL '5 days',
    CURRENT_TIMESTAMP - INTERVAL '3 days'
FROM pools WHERE status = 'open' LIMIT 1;

-- ==========================================
-- VERIFY SETUP
-- ==========================================
SELECT 'Database initialized successfully!' as status;
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as pool_count FROM pools;
SELECT COUNT(*) as trade_count FROM trades;

-- ==========================================
-- END OF INITIALIZATION
-- ==========================================