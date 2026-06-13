const pool = require('../database/pool');
require('dotenv').config();

async function testConnection() {
    console.log('🔍 Testing Render PostgreSQL connection...\n');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}\n`);

    try {
        // Test basic connection
        const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('✅ Successfully connected to database!');
        console.log(`🕐 Server time: ${result.rows[0].current_time}`);
        console.log(`🐘 PostgreSQL version: ${result.rows[0].pg_version}\n`);

        // Check if tables exist
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tables.rows.length > 0) {
            console.log('📋 Existing tables:');
            tables.rows.forEach(table => {
                console.log(`   - ${table.table_name}`);
            });
        } else {
            console.log('⚠️  No tables found. You need to run the database initialization script.');
        }

        // Check users count
        const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
        console.log(`\n👥 Users in database: ${userCount.rows[0].count}`);

    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        console.log('\n💡 Possible solutions:');
        console.log('   1. Run the database initialization script first');
        console.log('   2. Check if the database credentials are correct');
        console.log('   3. Verify the database is active on Render');
        console.log('   4. Try connecting via psql command line');
    } finally {
        pool.end();
    }
}

testConnection();