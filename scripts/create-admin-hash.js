const bcrypt = require('bcryptjs');

async function generateHash() {
    const password = 'Admin123!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    
    console.log('Password:', password);
    console.log('Generated Hash:', hash);
    console.log('\nCopy this SQL command:');
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'admin@tradingpool.com';`);
    console.log(`\nOR insert new admin:`);
    console.log(`INSERT INTO users (email, password_hash, full_name, is_admin) VALUES ('admin@tradingpool.com', '${hash}', 'System Admin', true) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, is_admin = EXCLUDED.is_admin;`);
}

generateHash();