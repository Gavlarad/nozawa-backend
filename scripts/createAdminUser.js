#!/usr/bin/env node

/**
 * Create Initial Admin User
 *
 * Creates the first admin user with secure password hashing.
 * This admin can access the admin panel and manage all resorts.
 */

const readline = require('readline');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function createAdmin() {
  console.log('='.repeat(60));
  console.log('CREATE INITIAL ADMIN USER');
  console.log('='.repeat(60));
  console.log('\nThis will create your first admin user with access to');
  console.log('all resorts and full admin panel privileges.\n');

  try {
    // Check if admin users already exist
    const existingAdmins = await pool.query('SELECT COUNT(*) FROM admin_users');
    const adminCount = parseInt(existingAdmins.rows[0].count);

    if (adminCount > 0) {
      console.log(`⚠️  Warning: ${adminCount} admin user(s) already exist.`);
      const proceed = await question('Create another admin? (yes/no): ');
      if (proceed.toLowerCase() !== 'yes') {
        console.log('Cancelled.');
        rl.close();
        await pool.end();
        process.exit(0);
      }
    }

    // Get admin details
    console.log('');
    const email = await question('Admin email: ');

    if (!email || !email.includes('@')) {
      console.error('❌ Invalid email address');
      rl.close();
      await pool.end();
      process.exit(1);
    }

    // Check if email already exists
    const emailCheck = await pool.query(
      'SELECT id FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (emailCheck.rows.length > 0) {
      console.error(`❌ Admin with email "${email}" already exists`);
      rl.close();
      await pool.end();
      process.exit(1);
    }

    const name = await question('Admin name (e.g., John Smith): ');
    const password = await question('Password (min 8 characters): ');

    if (password.length < 8) {
      console.error('❌ Password must be at least 8 characters');
      rl.close();
      await pool.end();
      process.exit(1);
    }

    const passwordConfirm = await question('Confirm password: ');

    if (password !== passwordConfirm) {
      console.error('❌ Passwords do not match');
      rl.close();
      await pool.end();
      process.exit(1);
    }

    rl.close();

    console.log('\n🔐 Hashing password...');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    console.log('💾 Creating admin user...');

    // Get all resort IDs for super admin access
    const resortsResult = await pool.query('SELECT id FROM resorts ORDER BY id');
    const resortIds = resortsResult.rows.map(r => r.id);

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
    console.log(`\n🔑 Credentials:`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: (the one you just entered)`);
    console.log(`\n📝 Save these credentials securely!`);
    console.log(`\n✨ Next steps:`);
    console.log(`   1. Test login at admin panel`);
    console.log(`   2. Keep these credentials safe`);
    console.log(`   3. You can create more admins later if needed\n`);

  } catch (error) {
    console.error('\n❌ Error creating admin user:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run
createAdmin().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
