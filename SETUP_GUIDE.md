# Stocksite Setup & System Verification Guide

## Overview

This setup system provides a comprehensive solution for initializing, verifying, and maintaining your Stocksite installation. It checks all system requirements, installs dependencies, verifies database and service connectivity, and can automatically repair corrupted installations.

## Quick Start

### Option 1: Using npm (Recommended)
```bash
# Full setup and verification
npm run setup

# Check system without installing
npm run setup:check

# Repair corrupted installation
npm run setup:repair

# Setup and start backend server
npm run setup:start
```

### Option 2: Using the shell script
```bash
# Make script executable (first time only)
chmod +x setup.sh

# Run setup
./setup.sh

# Show help
./setup.sh help
```

### Option 3: Using Node directly
```bash
# Full setup
node setup.js

# With options
node setup.js --repair
node setup.js --check-only
node setup.js --start
```

## What Does It Check?

### 🔧 System Requirements (Critical)
- **Node.js** (≥14.0.0)
- **npm** (≥6.0.0)
- **Git**

### 📦 Dependencies
- Backend npm packages (frontend/backend)
- Frontend npm packages (frontend)
- Node modules directories

### 📁 File Structure
- Backend directory
- Frontend directory
- Uploads directory

### 🔗 Service Connectivity
- PostgreSQL database (tcp://localhost:5432)
- Redis server (tcp://localhost:6379)

### 🎨 Optional Requirements (Recommended)
- **ImageMagick** - for image processing
- **PostgreSQL** - database server
- **Redis** - caching and job queue

## Commands Explained

### `npm run setup`
**Performs full setup and verification:**
1. Checks all system requirements
2. Verifies file structure
3. Tests optional tools (ImageMagick, Redis, PostgreSQL)
4. Installs or updates npm dependencies
5. Verifies database connectivity
6. Creates `.env` file if missing
7. Displays complete status report

### `npm run setup:check`
**Checks system without making any changes:**
- Useful for CI/CD pipelines
- Verifies prerequisites before operations
- No installation or modifications

### `npm run setup:repair`
**Repairs corrupted installations:**
1. Removes both backend and frontend `node_modules`
2. Clears npm cache
3. Reinstalls all dependencies from scratch
4. Verifies installation success

**Use this when:**
- Dependencies are corrupted
- Installation appears incomplete
- Random errors occur after updates
- Module conflicts arise

### `npm run setup:start`
**Full setup followed by backend server startup:**
1. Runs complete setup
2. Starts Node.js backend server
3. Server runs on http://localhost:5000
4. Press Ctrl+C to stop

## Environment Configuration

The script creates or updates `.env` file in the backend directory with default values:

```env
# Database Configuration
DB_USER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stocksite
DB_PASSWORD=

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Email Configuration (Optional)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# JWT Configuration
JWT_SECRET=your-secret-key-change-this

# Environment
NODE_ENV=development
PORT=5000
```

**Important:** Update these values with your actual configuration before running in production.

## Troubleshooting

### Issue: PostgreSQL not found
**Solution:** Install PostgreSQL
```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# Windows
Download from https://www.postgresql.org/download/windows/
```

### Issue: Redis not found
**Solution:** Install Redis
```bash
# macOS
brew install redis

# Ubuntu/Debian
sudo apt-get install redis-server

# Windows
Download from https://github.com/microsoftarchive/redis/releases
```

### Issue: ImageMagick not found
**Solution:** Install ImageMagick
```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install imagemagick

# Windows
Download from https://imagemagick.org/download/binaries/
```

### Issue: npm permission denied
**Solution:** Never use `sudo` with npm. Instead:
```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

### Issue: Dependencies still fail after repair
```bash
# Clear npm cache completely
npm cache clean --force

# Then run setup again
npm run setup
```

### Issue: Database connection fails
**Check the following:**
1. PostgreSQL is running: `psql -U postgres -l`
2. Database exists: `createdb stocksite`
3. Update `.env` with correct credentials
4. Test connection: `npm run setup:check`

### Issue: Redis connection fails
**Check the following:**
1. Redis is running: `redis-cli ping` (should return PONG)
2. Redis port is correct (default 6379)
3. Update `.env` with correct Redis configuration

## Status Report

After each setup run, a detailed status report shows:

```
✓ System Requirements
  ✓ Node.js: v18.x.x
  ✓ npm: 9.x.x
  ✓ Git: 2.x.x

✓ Dependencies
  ✓ Backend
  ✓ Frontend

✓ Services
  ✓ PostgreSQL
  ✓ Redis

✓ Optional Requirements
  ✓ ImageMagick
```

Green checkmarks indicate successful setup. Yellow warnings for optional tools that are not installed.

## Automation

### Run setup on project clone
```bash
git clone <your-repo>
cd stocksite
npm run setup
```

### Continuous Integration
```yaml
# .github/workflows/setup.yml
- name: Setup Stocksite
  run: npm run setup:check
```

### Pre-commit Hook
Create `.git/hooks/pre-commit`:
```bash
#!/bin/bash
npm run setup:check
```

## Advanced Usage

### Environment Variables
The script respects these environment variables:
- `NODE_ENV` - Set to 'production' or 'development'
- `DB_*` - Database configuration
- `REDIS_*` - Redis configuration

### Custom Configuration
Modify the CONFIGURATION section in `setup.js` to:
- Add custom requirements
- Change port numbers
- Add additional checks

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the status report for specific errors
3. Run `npm run setup:check` to diagnose
4. Check service connectivity manually:
   ```bash
   # Database
   psql -U postgres -d stocksite -c "SELECT NOW();"
   
   # Redis
   redis-cli ping
   ```

## Maintenance

Run setup periodically to:
- Verify system integrity
- Check for dependency updates
- Ensure all services are reachable
- Detect configuration issues early

**Recommended:** Run before deploying changes
```bash
npm run setup:check
```

## Version History

- **v1.0.0** - Initial release with full system verification and repair capabilities
