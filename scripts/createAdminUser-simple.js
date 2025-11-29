#!/usr/bin/env node

/**
 * Create Admin User (Simple Version)
 *
 * Usage: node scripts/createAdminUser-simple.js <email> <name> <password>
 * Example: node scripts/createAdminUser-simple.js admin@example.com "John Smith" "MySecurePass123"
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createAdmin(email, name, password) {
  console.log('🔐 Creating admin user...\n');

  // Validation
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email address');
  }

  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  try {
    // Check if email already exists
    const emailCheck = await pool.query(
      'SELECT id FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (emailCheck.rows.length > 0) {
      throw new Error(`Admin with email "${email}" already exists`);
    }

    // Hash password
    console.log('🔒 Hashing password...');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Get all resort IDs for super admin access
    const resortsResult = await pool.query('SELECT id FROM resorts ORDER BY id');
    const resortIds = resortsResult.rows.map(r => r.id);

    // Create admin user
    console.log('💾 Saving to database...');
    const result = await pool.query(`
      INSERT INTO admin_users (
        email, password_hash, name, role, resort_access, active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, name, role
    `, [
      email.toLowerCase(),
      passwordHash,
      name,
      'super_admin',
      resortIds,
      true
    ]);

    const admin = result.rows[0];

    console.log('\n' + '='.repeat(60));
    console.log('✅ ADMIN USER CREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log(`\nAdmin ID: ${admin.id}`);
    console.log(`Email: ${admin.email}`);
    console.log(`Name: ${admin.name}`);
    console.log(`Role: ${admin.role}`);
    console.log(`Resort Access: All resorts (${resortIds.join(', ')})`);
    console.log(`\n🔑 Login Credentials:`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: ${password}`);
    console.log(`\n📝 IMPORTANT: Save these credentials securely!`);
    console.log(`\n✨ Next steps:`);
    console.log(`   1. Test login at your admin panel`);
    console.log(`   2. Change password after first login (recommended)`);
    console.log(`   3. Delete this output from your terminal history\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length !== 3) {
  console.error('Usage: node createAdminUser-simple.js <email> <name> <password>');
  console.error('Example: node createAdminUser-simple.js admin@nozawa.com "Admin User" "SecurePass123"');
  process.exit(1);
}

const [email, name, password] = args;

createAdmin(email, name, password).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
