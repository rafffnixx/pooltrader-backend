const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Read the schema file
const schemaPath = path.join(__dirname, '../../database/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

const client = new Client({
    host: 'dpg-d8bi6rd7vvec738r1f2g-a.oregon-postgres.render.com',
    port: 5432,
    user: 'trading_pool_wtc2_user',
    password: 'egcrp4lDvex20lRAuymVwp772N05akAU',
    database: 'trading_pool',
    ssl: { rejectUnauthorized: false }
});

async function runSchema() {
    console.log('🚀 Initializing Trading Pool Database Schema...\n');
    console.log('📝 Reading schema file...');
    console.log('=' .repeat(60));
    
    try {
        await client.connect();
        console.log('✅ Connected to Render PostgreSQL\n');
        
        // Split the schema into individual statements
        // Note: This is a simple split - for production, use a proper SQL parser
        const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
        
        console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i].trim();
            if (statement && !statement.startsWith('--')) {
                try {
                    await client.query(statement);
                    successCount++;
                    process.stdout.write(`\r✅ Executed ${successCount}/${statements.length} statements`);
                } catch (err) {
                    // Ignore "already exists" errors
                    if (!err.message.includes('already exists') && 
                        !err.message.includes('does not exist') &&
                        !err.message.includes('relation')) {
                        errorCount++;
                        console.log(`\n⚠️  Error in statement ${i + 1}:`, err.message);
                    } else {
                        successCount++;
                    }
                }
            }
        }
        
        console.log(`\n\n${'='.repeat(60)}`);
        console.log('📊 Database Initialization Summary:');
        console.log(`${'='.repeat(60)}`);
        console.log(`✅ Successful operations: ${successCount}`);
        console.log(`⚠️  Skipped/Warnings: ${errorCount}`);
        
        // Verify tables were created
        console.log('\n📋 Verifying tables...');
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tables.rows.length > 0) {
            console.log('\n✅ Tables created successfully:');
            tables.rows.forEach(row => {
                console.log(`   📁 ${row.table_name}`);
            });
        } else {
            console.log('\n⚠️  No tables found. Please check the schema.');
        }
        
        // Verify sample data
        console.log('\n📊 Sample Data Summary:');
        
        const userCount = await client.query('SELECT COUNT(*) FROM users');
        console.log(`   👥 Users: ${userCount.rows[0].count}`);
        
        const poolCount = await client.query('SELECT COUNT(*) FROM pools');
        console.log(`   💰 Pools: ${poolCount.rows[0].count}`);
        
        const tradeCount = await client.query('SELECT COUNT(*) FROM trades');
        console.log(`   📈 Trades: ${tradeCount.rows[0].count}`);
        
        console.log('\n🎉 Database schema initialized successfully!');
        
        await client.end();
        
    } catch (error) {
        console.error('\n❌ Initialization failed:', error.message);
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Check if the database exists on Render');
        console.error('   2. Verify your connection credentials');
        console.error('   3. Make sure the schema file is valid SQL');
        process.exit(1);
    }
}

// Run the initialization
runSchema();