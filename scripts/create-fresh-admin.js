const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
    host: 'dpg-d8bi6rd7vvec738r1f2g-a.oregon-postgres.render.com',
    port: 5432,
    user: 'trading_pool_wtc2_user',
    password: 'egcrp4lDvex20lRAuymVwp772N05akAU',
    database: 'trading_pool',
    ssl: { rejectUnauthorized: false }
});

async function createFreshAdmin() {
    try {
        await client.connect();
        console.log('✅ Connected to database\n');
        
        // Hash the password
        const password = 'Admin123!';
        const hash = await bcrypt.hash(password, 10);
        
        console.log('📝 Creating new admin user:');
        console.log('   Email: admin2@tradingpool.com');
        console.log('   Password: Admin123!');
        console.log('   Hash:', hash.substring(0, 30) + '...\n');
        
        // Check if user already exists
        const checkResult = await client.query(
            "SELECT id, email FROM users WHERE email = $1",
            ['admin2@tradingpool.com']
        );
        
        if (checkResult.rows.length > 0) {
            console.log('⚠️  User already exists, updating password...');
            await client.query(
                "UPDATE users SET password_hash = $1, is_admin = true WHERE email = $2",
                [hash, 'admin2@tradingpool.com']
            );
        } else {
            // Insert new admin
            await client.query(`
                INSERT INTO users (email, password_hash, full_name, is_admin, total_deposited, total_withdrawn, current_balance) 
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, ['admin2@tradingpool.com', hash, 'Admin User 2', true, 0, 0, 0]);
            console.log('✅ New admin user created successfully!');
        }
        
        // Verify the user was created/updated
        const result = await client.query(
            "SELECT id, email, full_name, is_admin FROM users WHERE email = 'admin2@tradingpool.com'"
        );
        
        console.log('\n📋 Admin user details:');
        console.log(`   ID: ${result.rows[0].id}`);
        console.log(`   Email: ${result.rows[0].email}`);
        console.log(`   Name: ${result.rows[0].full_name}`);
        console.log(`   Admin: ${result.rows[0].is_admin}`);
        
        console.log('\n✅ You can now login with:');
        console.log('   Email: admin2@tradingpool.com');
        console.log('   Password: Admin123!');
        
        await client.end();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

createFreshAdmin();