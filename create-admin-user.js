/**
 * Create Admin User in PostgreSQL
 * Run this once to create the initial admin account
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createAdminUser() {
  const email = 'admin@nozawa.com';
  const password = 'NozawaAdmin2024!';
  const name = 'Nozawa Admin';
  const role = 'super_admin';

  try {
    console.log('\n🔐 Creating admin user...');
    console.log('Email:', email);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existing = await pool.query(
      'SELECT id, email FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      console.log('⚠️  Admin user already exists!');
      console.log('Updating password...');

      await pool.query(
        'UPDATE admin_users SET password_hash = $1, active = true WHERE email = $2',
        [passwordHash, email.toLowerCase()]
      );

      console.log('✅ Password updated successfully');
    } else {
      // Create new admin user
      const result = await pool.query(
        `INSERT INTO admin_users (email, password_hash, name, role, resort_access, active, created_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())
         RETURNING id, email, name, role`,
        [email.toLowerCase(), passwordHash, name, role, [1]]
      );

      console.log('✅ Admin user created successfully!');
      console.log('Details:', result.rows[0]);
    }

    console.log('\nLogin credentials:');
    console.log('  Email:', email);
    console.log('  Password:', password);
    console.log('  Role:', role);
    console.log('\n✅ Done!\n');

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

createAdminUser();
