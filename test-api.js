const pool = require('../database/pool');

async function testDatabase() {
    console.log('🔍 Testing Database Connection and Schema...\n');
    
    try {
        // Test 1: Check connection
        console.log('1. Testing connection...');
        const timeResult = await pool.query('SELECT NOW() as time');
        console.log('   ✅ Connected, current time:', timeResult.rows[0].time);
        
        // Test 2: Check tables
        console.log('\n2. Checking tables...');
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log(`   ✅ Found ${tables.rows.length} tables`);
        tables.rows.forEach(row => {
            console.log(`      - ${row.table_name}`);
        });
        
        // Test 3: Check sample data
        console.log('\n3. Checking sample data...');
        const users = await pool.query('SELECT COUNT(*) FROM users');
        console.log(`   👥 Users: ${users.rows[0].count}`);
        
        const pools = await pool.query('SELECT COUNT(*) FROM pools');
        console.log(`   💰 Pools: ${pools.rows[0].count}`);
        
        const trades = await pool.query('SELECT COUNT(*) FROM trades');
        console.log(`   📈 Trades: ${trades.rows[0].count}`);
        
        // Test 4: Show active pool
        console.log('\n4. Active pool details...');
        const activePool = await pool.query(`
            SELECT name, total_target, current_total, status 
            FROM pools 
            WHERE status IN ('open', 'active')
            LIMIT 1
        `);
        
        if (activePool.rows.length > 0) {
            const pool = activePool.rows[0];
            console.log(`   📊 Name: ${pool.name}`);
            console.log(`   🎯 Target: $${pool.total_target.toLocaleString()}`);
            console.log(`   💵 Current: $${pool.current_total.toLocaleString()}`);
            console.log(`   🔘 Status: ${pool.status}`);
        }
        
        console.log('\n🎉 All tests passed! Database is ready for use.\n');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

testDatabase();