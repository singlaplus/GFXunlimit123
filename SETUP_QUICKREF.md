# Stocksite Setup - Quick Reference Card

## 🚀 One-Command Setup (Pick One)

```bash
# Option 1: npm (Recommended)
npm run setup

# Option 2: Shell script
./setup.sh

# Option 3: Node directly
node setup.js
```

## 📋 Available Commands

| Command | Description | Use When |
|---------|-------------|----------|
| `npm run setup` | Full setup and verification | First time setup or periodic maintenance |
| `npm run setup:check` | Check without installing | CI/CD pipelines or pre-deployment |
| `npm run setup:repair` | Fix corrupted installation | Errors after updates or module conflicts |
| `npm run setup:start` | Setup and start backend server | Starting development environment |

## 🔍 What Gets Checked

✅ **System Requirements**
- Node.js ≥ 14.0.0
- npm ≥ 6.0.0
- Git

✅ **Dependencies**
- Backend npm packages
- Frontend npm packages

✅ **File Structure**
- Directories exist
- Uploads folder accessible

✅ **Optional Tools**
- PostgreSQL (database)
- Redis (cache/queue)
- ImageMagick (image processing)

✅ **Service Connectivity**
- Database connection
- Redis connection

## ⚡ Quick Troubleshooting

**Installation fails?**
```bash
npm run setup:repair
```

**Check if everything is working?**
```bash
npm run setup:check
```

**Start backend directly?**
```bash
npm run setup:start
```

**View detailed help?**
```bash
node setup.js --help
./setup.sh help
```

## 📁 Files Created

- **setup.js** - Main setup script (Node.js)
- **setup.sh** - Shell wrapper for easy execution
- **SETUP_GUIDE.md** - Comprehensive documentation
- **SETUP_QUICKREF.md** - This quick reference

## 🎯 Typical Workflow

1. **First Time Setup:**
   ```bash
   npm run setup
   ```

2. **Verify System Health:**
   ```bash
   npm run setup:check
   ```

3. **Fix Issues:**
   ```bash
   npm run setup:repair
   ```

4. **Start Development:**
   ```bash
   npm run setup:start
   ```

## 🔄 Automated Setup

Add to your `.bashrc` or `.zshrc` for super quick setup:
```bash
alias stocksite-setup='cd ~/Documents/stocksite && npm run setup'
alias stocksite-check='cd ~/Documents/stocksite && npm run setup:check'
alias stocksite-start='cd ~/Documents/stocksite && npm run setup:start'
```

Then use:
```bash
stocksite-setup
stocksite-check
stocksite-start
```

## 📊 Status Report

After setup, you'll see:
```
✓ System Requirements (Node.js, npm, Git)
✓ Dependencies (Backend, Frontend)
✓ Services (PostgreSQL ✓, Redis ✗)
✓ Optional Requirements (ImageMagick ✗)
```

Green ✓ = Working
Yellow ⚠ = Optional (not installed but not required)
Red ✗ = Problem (needs attention)

## 🆘 Need Help?

- **Detailed Guide:** See `SETUP_GUIDE.md`
- **Quick Troubleshooting:** See section above
- **Check Specific Issues:** Run `npm run setup:check`
- **Full Installation from Scratch:** Run `npm run setup:repair`

---

**Last Updated:** 2024
**Version:** 1.0.0
