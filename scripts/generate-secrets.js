#!/usr/bin/env node

/**
 * Generate secure secrets for deployment
 */

const crypto = require('crypto');

console.log('🔐 Generating secure secrets for deployment...\n');

// Generate JWT secret
const jwtSecret = crypto.randomBytes(32).toString('base64');

// Generate a secure admin password
const adminPassword = crypto.randomBytes(16).toString('base64').slice(0, 16) + '!A1';

console.log('📋 Environment Variables for Production:');
console.log('=====================================');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log('\n🔑 Security Recommendations:');
console.log('============================');
console.log(`Suggested new admin password: ${adminPassword}`);
console.log('\n⚠️  Important Notes:');
console.log('- Copy these values to your Vercel environment variables');
console.log('- Never commit these values to your repository');
console.log('- Change the default admin password after first login');
console.log('- Keep these secrets secure and backed up');

console.log('\n📝 Current Default Admin Login:');
console.log('Email: admin@poscrm.com');
console.log('Password: Admin@2024Secure!');
console.log('👆 Change this password immediately after deployment!');
