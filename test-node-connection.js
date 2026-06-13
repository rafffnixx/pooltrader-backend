const { Client } = require('pg');

const client = new Client({
    host: 'dpg-d8bi6rd7vvec738r1f2g-a.oregon-postgres.render.com',
    port: 5432,
    user: 'trading_pool_wtc2_user',
    password: 'egcrp4lDvex20lRAuymVwp772N05akAU',
    database: 'trading_pool',
    ssl: { rejectUnauthorized: false }
});

async function test() {
    console.log('🔍 Testing Node.js connection to Render PostgreSQL...\n');
    
    try {
        await client.connect();
        console.log('✅ Connected successfully!\n');
        
        // Test query
        const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('📊 Current time:', result.rows[0].current_time);
        console.log('🐘 PostgreSQL version:', result.rows[0].pg_version.split(',')[0]);
        
        // Check if tables exist
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tables.rows.length > 0) {
            console.log('\n📋 Existing tables:');
            tables.rows.forEach(row => {
                console.log(`   - ${row.table_name}`);
            });
        } else {
            console.log('\n⚠️  No tables found. You need to initialize the database.');
            console.log('Run: npm run db:init');
        }
        
        await client.end();
        console.log('\n✅ Test completed successfully!');
        
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
    }
}

test();