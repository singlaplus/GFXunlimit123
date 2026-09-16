# 🎯 Getting Started with Stocksite Setup

## The Fastest Way to Get Started

Copy and paste this ONE command into your terminal:

```bash
npm run setup
```

That's it! The script will:
- ✅ Check if you have Node.js, npm, and Git
- ✅ Install all backend dependencies
- ✅ Install all frontend dependencies
- ✅ Create your configuration file (.env)
- ✅ Check if PostgreSQL and Redis are available
- ✅ Verify everything is working
- ✅ Tell you the status

## What You'll See

When you run the command, you'll see something like:

```
======================================================================
[8:30:13 PM] 📋 Full System Setup
======================================================================

→ Checking System Requirements
✅ Node.js: 22.23.1
✅ npm: 10.9.8
✅ Git: 2.50.1

→ Checking Dependencies
✅ Backend dependencies: installing...
✅ Frontend dependencies: installing...

→ Checking Services
✅ PostgreSQL: Connected
⚠️  Redis: Not connected (optional)

======================================================================
[8:31:45 PM] ✅ SETUP COMPLETE - System is ready to run!
======================================================================
```

Green ✅ = Good to go
Yellow ⚠️ = Optional (not required)
Red ❌ = Needs attention

## Other Commands

Once setup is complete, you can use these commands:

### Start Backend Server
```bash
npm run setup:start
```
- Runs setup verification
- Starts backend on port 5000
- Great for development

### Check System Health
```bash
npm run setup:check
```
- Verifies everything without installing
- Good for troubleshooting
- Safe to run anytime

### Repair Installation
```bash
npm run setup:repair
```
- Removes corrupted dependencies
- Cleans cache
- Reinstalls everything fresh
- Use if something breaks

### View Help
```bash
node setup.js --help
```
Shows all available commands

## Typical First-Time Workflow

### Step 1: Run Setup
```bash
npm run setup
```
Wait for it to complete...

### Step 2: Check Status
The script will display a summary showing:
- ✅ System requirements (Node.js, npm, Git)
- ✅ Installed packages (Backend, Frontend)
- ⚠️  Optional services (PostgreSQL, Redis)
- ✅ Setup success message

### Step 3: Start Backend (Optional)
```bash
npm run setup:start
```
Backend will run on: http://localhost:5000

### Step 4: Start Frontend (In another terminal)
```bash
cd frontend && npm start
```
Frontend will run on: http://localhost:3000

## What If Something Goes Wrong?

### "X is not installed"
The setup will tell you what's missing. For example:
```
⚠️  Redis: NOT FOUND (optional but recommended)
```

This means Redis is optional. If you want to install it:
- **macOS:** `brew install redis`
- **Linux:** `sudo apt-get install redis-server`

### "Installation failed"
Run the repair command:
```bash
npm run setup:repair
```
This completely cleans and reinstalls everything.

### "Can't connect to database"
Make sure PostgreSQL is running:
```bash
# Check if PostgreSQL is running
psql --version

# Start PostgreSQL (macOS)
brew services start postgresql

# Start PostgreSQL (Linux)
sudo systemctl start postgresql
```

Then run setup again:
```bash
npm run setup
```

## Configuration (.env file)

The setup script creates a `.env` file automatically. You might need to update it if:
- Your database password is different
- Your PostgreSQL is on a different host
- Your Redis is on a different port

Edit `backend/.env` and update:
```env
DB_USER=postgres          # Your database user
DB_PASSWORD=              # Your database password
DB_HOST=localhost         # Where PostgreSQL runs
DB_PORT=5432              # PostgreSQL port
REDIS_HOST=localhost      # Where Redis runs
REDIS_PORT=6379           # Redis port
```

## Files Created

- `setup.js` - The main setup script (executable)
- `setup.sh` - Shell wrapper (for easy use)
- `SETUP_GUIDE.md` - Full documentation
- `SETUP_QUICKREF.md` - Quick reference
- `SETUP_IMPLEMENTATION_COMPLETE.md` - Implementation details
- `GETTING_STARTED.md` - This file!

## Pro Tips

### Tip 1: Create Aliases
Add to your `.bashrc` or `.zshrc`:
```bash
alias ss='npm run setup'
alias ss-check='npm run setup:check'
alias ss-repair='npm run setup:repair'
```

Then use:
```bash
ss           # Run setup
ss-check     # Check status
ss-repair    # Repair
```

### Tip 2: Run Before Pulling Updates
Always run after pulling code changes:
```bash
git pull
npm run setup:check
```

### Tip 3: Automate with Scripts
Create `startup.sh`:
```bash
#!/bin/bash
npm run setup:start &
cd frontend && npm start
```

Then run: `./startup.sh`

### Tip 4: Use in CI/CD
In GitHub Actions, CircleCI, etc.:
```yaml
- name: Setup Stocksite
  run: npm run setup:check
```

## Troubleshooting Checklist

□ Run `npm run setup` one more time
□ Run `npm run setup:check` to see detailed status
□ Check your internet connection
□ Make sure Node.js is installed: `node --version`
□ Make sure npm is installed: `npm --version`
□ Try `npm run setup:repair`
□ Check if PostgreSQL is running
□ Check if ports 3000 and 5000 are available
□ Look at the error message carefully
□ Read `SETUP_GUIDE.md` for detailed help

## Still Having Issues?

1. **Read the full guide:** `SETUP_GUIDE.md`
2. **Check error details:** Run again and look for specific errors
3. **Try the repair:** `npm run setup:repair`
4. **Verify services:** Check PostgreSQL and Redis manually
5. **Check the troubleshooting section:** `SETUP_GUIDE.md` has detailed solutions

## Summary

You have THREE ways to run setup:

```bash
# Method 1: npm (recommended)
npm run setup

# Method 2: shell script
./setup.sh

# Method 3: direct node
node setup.js
```

All three do exactly the same thing. Pick whichever you prefer!

## Next Steps

1. Run the setup command
2. Wait for it to complete
3. Check the status report
4. Start developing!

```bash
npm run setup
```

That's all you need to get started! 🚀

---

**Questions?** Check `SETUP_GUIDE.md` for detailed documentation.
**Quick questions?** Check `SETUP_QUICKREF.md` for a quick reference.
**Need to repair?** Use `npm run setup:repair`
