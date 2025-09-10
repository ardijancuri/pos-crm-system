#!/usr/bin/env node

/**
 * Pre-deployment check script
 * Verifies that all necessary files and configurations are in place
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running pre-deployment checks...\n');

const checks = [
  {
    name: 'Root vercel.json exists',
    check: () => fs.existsSync('vercel.json'),
    fix: 'Create vercel.json in root directory'
  },
  {
    name: 'Client vercel.json exists',
    check: () => fs.existsSync('client/vercel.json'),
    fix: 'Create vercel.json in client directory'
  },
  {
    name: 'Supabase migration file exists',
    check: () => fs.existsSync('supabase-migration.sql'),
    fix: 'Create supabase-migration.sql file'
  },
  {
    name: 'Environment example files exist',
    check: () => fs.existsSync('env.production.example') && fs.existsSync('client/env.example'),
    fix: 'Create environment example files'
  },
  {
    name: 'Package.json has correct scripts',
    check: () => {
      try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        return pkg.scripts && pkg.scripts.build;
      } catch {
        return false;
      }
    },
    fix: 'Add build script to package.json'
  },
  {
    name: 'Client package.json has build script',
    check: () => {
      try {
        const pkg = JSON.parse(fs.readFileSync('client/package.json', 'utf8'));
        return pkg.scripts && pkg.scripts.build;
      } catch {
        return false;
      }
    },
    fix: 'Client build script exists'
  }
];

let allPassed = true;

checks.forEach(({ name, check, fix }) => {
  const passed = check();
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${name}`);
  
  if (!passed) {
    console.log(`   💡 Fix: ${fix}`);
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(50));

if (allPassed) {
  console.log('🎉 All checks passed! Ready for deployment.');
  console.log('\n📋 Next steps:');
  console.log('1. Push code to GitHub');
  console.log('2. Set up Supabase project');
  console.log('3. Run supabase-migration.sql in Supabase SQL Editor');
  console.log('4. Deploy backend to Vercel');
  console.log('5. Deploy frontend to Vercel');
  console.log('6. Configure environment variables');
  console.log('\n📖 See deploy.md for detailed instructions');
} else {
  console.log('❌ Some checks failed. Please fix the issues above before deploying.');
  process.exit(1);
}
