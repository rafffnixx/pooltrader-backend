const bcrypt = require('bcryptjs');

const password = 'Admin123!';
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
        console.error('Error generating hash:', err);
    } else {
        console.log('Password:', password);
        console.log('Hash:', hash);
        console.log('\nUse this SQL to insert/update admin user:');
        console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'admin@tradingpool.com';`);
        console.log(`\nOR insert new admin user:`);
        console.log(`INSERT INTO users (email, password_hash, full_name, is_admin) VALUES ('admin@tradingpool.com', '${hash}', 'System Admin', true) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;`);
    }
});