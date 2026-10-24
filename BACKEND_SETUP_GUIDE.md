# Backend Setup & Image Generation Guide

## Overview

This guide explains how to set up the backend server with automatic dependency checking and how to generate images via command line.

## Quick Start

### 1. Start Backend with Automatic Setup

Simply run the bootstrap script, which automatically:
- ✓ Detects installed dependencies
- ✓ Installs missing npm packages
- ✓ Installs missing system tools (Ghostscript, ImageMagick, etc.)
- ✓ Starts the backend server

```bash
cd backend
npm start
# or
node startup/bootstrap.js
```

### Backup Retention

Backup archives are retained by count so the application directory does not grow without limit. Set `BACKUP_RETENTION_COUNT` in the backend environment to change the limit; the default is 30 archives.

```env
BACKUP_RETENTION_COUNT=30
```

### 2. Generate Image Thumbnails

Once the server is running, generate thumbnails from the CLI:

```bash
# Generate thumbnail for PSD file
node image-generator-cli.js generate ./uploads/image.psd

# Generate JPG thumbnail with custom quality
node image-generator-cli.js generate ./uploads/file.eps --format=jpg --quality=85

# Check if a file can be processed
node image-generator-cli.js check ./uploads/file.ai

# View system dependency status
node image-generator-cli.js status
```

## System Requirements

### Required Dependencies

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Node.js** | JavaScript runtime | Install from nodejs.org |
| **npm** | Package manager | Included with Node.js |
| **PostgreSQL** | Database | Configure a reachable PostgreSQL server; the backend uses its `pg` driver |
| **Redis** | Job queue | Installed automatically (see below) |
| **Sharp** | Image processing | Installed via `npm install` |

### Optional but Recommended

| Tool | Purpose | Installation |
|------|---------|--------------|
| **Ghostscript** | EPS/AI file processing | Installed automatically (see below) |
| **ImageMagick** | Image conversion fallback | Installed automatically (see below) |

## Automatic Installation by Platform

### macOS

If image-processing system tools are missing, the bootstrap script may install them. PostgreSQL must be configured as a reachable service; the `psql` command-line tool is optional because the backend connects using its Node.js `pg` driver.

If image-processing system tools are missing, the bootstrap script may run:

```bash
# The bootstrap will attempt to run these if needed
brew install ghostscript
brew install imagemagick
brew install redis
```

**Prerequisites:** Homebrew must be installed
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Linux (Ubuntu/Debian)

```bash
# The bootstrap will attempt to run these if needed
sudo apt-get install -y ghostscript
sudo apt-get install -y imagemagick
sudo apt-get install -y redis-server
```

### Windows

```bash
# The bootstrap will attempt to run these if needed (requires admin)
winget install --id ArtifexSoftware.GhostScript -e
winget install --id ImageMagick.ImageMagick -e
winget install --id tporadowski.redis -e
```

**Prerequisites:** Windows Package Manager (winget) or Chocolatey

## Environment Variables

You can control startup behavior with environment variables:

```bash
# Skip PostgreSQL installation check
SKIP_DB_CHECK=true npm start

# Skip Redis installation check
SKIP_REDIS_CHECK=true npm start

# Set custom port
PORT=3000 npm start

# Combine multiple
SKIP_DB_CHECK=true PORT=3000 npm start
```

The backend reads its service and storage settings from the existing environment configuration. `PC2_ASSET_SERVER_URL` selects the remote asset service origin; `ASSETS_ROOT` and `THUMBNAIL_STORAGE_PATH` identify the current default local asset and thumbnail storage roots. Additional storage roots can be registered in the authenticated Assets Connection controls; each type has an independent default, which receives new writes while previously registered roots remain available for existing files. The selected defaults are also written to these environment variables. Optional `CORS_ALLOWED_ORIGINS` replaces the default development/site CORS allowlist with comma-separated HTTP(S) origins. When setting it, include every origin that should be allowed. Set storage roots for the server's actual filesystem and service account. A browser-selected folder is not a server-side backup destination. Database connection variables and startup/migration behavior are unchanged.

Production frontend builds require `REACT_APP_API_BASE_URL`. Local development and tests retain the `http://localhost:5000` fallback, while the production build exits with an error if the API URL is absent or invalid.

## Startup Process

When you run `npm start`:

1. **Bootstrap loads** - Checks system setup
2. **Dependencies detected** - Scans for installed tools
3. **Missing items identified** - Lists what needs to be installed
4. **Installation runs** - Installs missing packages
5. **Server starts** - Express server launches on port 5000 (default)

### Example Startup Output

```
========================================
  BACKEND DEPENDENCY CHECKER
========================================

Platform Detected: darwin

Dependency Status:
  ✓ Node Modules: installed
  ✓ Sharp: installed
  ✓ PSD Library: installed
  ✓ Ghostscript: installed
  ✓ ImageMagick: installed
  ✓ PostgreSQL client: available
  ✓ Redis: installed

✓ All dependencies are installed!
Starting server...

Server running on port 5000
```

## Image Generation CLI

### Available Commands

#### `generate <filepath>`

Generate a thumbnail for an image file.

```bash
node image-generator-cli.js generate ./path/to/image.psd
```

**Options:**
- `--format=png|jpg|webp` - Output format (default: png)
- `--quality=1-100` - Quality level (default: 90)
- `--width=pixels` - Thumbnail width (default: 300)
- `--height=pixels` - Thumbnail height (default: 300)

**Examples:**
```bash
# Generate PNG thumbnail
node image-generator-cli.js generate ./uploads/image.psd

# Generate high-quality JPG
node image-generator-cli.js generate ./uploads/image.psd --format=jpg --quality=95

# Generate small WebP thumbnail
node image-generator-cli.js generate ./uploads/image.psd --format=webp --width=100 --height=100
```

#### `check <filepath>`

Analyze a file to see if it can be processed.

```bash
node image-generator-cli.js check ./uploads/file.ai
```

**Output:**
```
File Analysis:
ℹ Name: file.ai
ℹ Type: AI/EPS
ℹ Size: 2.45 KB
ℹ Path: ./uploads/file.ai
✓ File type AI/EPS is supported
```

#### `status`

Display versions of all system dependencies.

```bash
node image-generator-cli.js status
```

**Output:**
```
System Dependencies:
✓ Node.js: v18.16.0
✓ Sharp: 0.34.5
✓ Ghostscript: 10.01.2
✓ ImageMagick: 7.1.1-Q16 HDRI
```

## Troubleshooting

### Issue: "Ghostscript not found"

**Solution:**
```bash
# macOS
brew install ghostscript

# Linux
sudo apt-get install ghostscript

# Windows (admin required)
winget install --id ArtifexSoftware.GhostScript -e
```

### Issue: "ImageMagick not found"

**Solution:**
```bash
# macOS
brew install imagemagick

# Linux
sudo apt-get install imagemagick

# Windows (admin required)
winget install --id ImageMagick.ImageMagick -e
```

### Issue: "PostgreSQL connection failed"

**Solution:**
1. Ensure PostgreSQL is running
2. Check `.env` file for correct database credentials
3. Verify database exists: `createdb stocksite`

### Issue: "Redis connection failed"

**Solution:**
1. Ensure Redis is running
2. macOS: `redis-server` or `brew services start redis`
3. Linux: `redis-server` or `systemctl start redis`
4. Windows: Use `redis-cli` to check connection

### Issue: "Sharp installation fails"

**Solution:**
```bash
# Clear npm cache and reinstall
npm cache clean --force
npm install sharp --build-from-source
```

## File Type Support

### Supported Image Formats

| Format | Extension | Support |
|--------|-----------|---------|
| **Adobe Photoshop** | .psd | ✓ Full |
| **Adobe Illustrator** | .ai | ✓ Full |
| **Encapsulated PostScript** | .eps | ✓ Full |
| **PDF** | .pdf | ✓ Partial |
| **PNG** | .png | ✓ Full |
| **JPEG** | .jpg, .jpeg | ✓ Full |
| **GIF** | .gif | ✓ Full |
| **WebP** | .webp | ✓ Full |

## Database Setup

After configuring a reachable PostgreSQL database (the `psql` CLI is needed only for these manual commands):

```bash
# Create the database
createdb stocksite

# Run migrations
psql stocksite < backend/migrations/001_email_tables.sql
psql stocksite < backend/migrations/002_thumbnail_system.sql
```

## Starting Redis

```bash
# macOS
redis-server

# Linux
redis-server

# Windows
redis-cli
```

## Logs

The bootstrap logs are saved to:
```
backend/startup/bootstrap.log
```

View the logs:
```bash
cat backend/startup/bootstrap.log
tail -f backend/startup/bootstrap.log  # Follow in real-time
```

## Development Tips

### Run with Environment Variables

```bash
# Set environment for development
NODE_ENV=development npm start

# Enable verbose logging
DEBUG=* npm start
```

### Rebuild Native Dependencies

```bash
npm rebuild sharp
npm rebuild better-sqlite3
```

### Update All Dependencies

```bash
npm update
```

## Next Steps

1. ✓ Run `npm start` in the backend folder
2. ✓ Wait for dependencies to install
3. ✓ Server starts automatically on http://localhost:5000
4. ✓ Use `image-generator-cli.js` to generate thumbnails
5. ✓ Check logs in `backend/startup/bootstrap.log`

## Getting Help

If you encounter issues:

1. Check the bootstrap log: `cat backend/startup/bootstrap.log`
2. Verify dependencies: `node image-generator-cli.js status`
3. Test file compatibility: `node image-generator-cli.js check <file>`
4. Review error messages carefully

---

**Last Updated:** August 2024
**Tested On:** macOS 13+, Ubuntu 20.04+, Windows 10+
