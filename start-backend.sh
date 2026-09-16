#!/bin/bash

# Backend Quick Start Script
# This script starts the backend with automatic dependency checking

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Print colored output
print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Main script
main() {
    clear
    
    print_header "========================================="
    print_header "     STOCKSITE BACKEND QUICK START"
    print_header "========================================="
    echo ""
    
    # Check if we're in the right directory
    if [ ! -f "backend/package.json" ]; then
        print_error "Error: backend/package.json not found!"
        echo "Please run this script from the project root directory:"
        echo "  cd /path/to/stocksite"
        echo "  ./start-backend.sh"
        exit 1
    fi
    
    # Navigate to backend
    cd backend
    
    echo ""
    print_header "Step 1: Checking dependencies..."
    echo ""
    
    # Show what's being checked
    echo "Checking:"
    echo "  • Node.js and npm"
    echo "  • npm packages (Sharp, PSD libraries)"
    echo "  • System tools (Ghostscript, ImageMagick)"
    echo "  • Database (PostgreSQL)"
    echo "  • Cache system (Redis)"
    echo ""
    
    # Run bootstrap
    print_header "Step 2: Running bootstrap..."
    echo ""
    
    node startup/bootstrap.js
    
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo ""
        print_success "Backend started successfully!"
        echo ""
        echo "Your server is running at: ${BLUE}http://localhost:5000${NC}"
        echo ""
        echo "Available CLI commands:"
        echo "  node image-generator-cli.js status          # Check system setup"
        echo "  node image-generator-cli.js check <file>    # Check if file can be processed"
        echo "  node image-generator-cli.js generate <file> # Generate thumbnail"
        echo ""
        print_success "Backend is ready to use!"
    else
        print_error "Bootstrap failed with exit code: $EXIT_CODE"
        echo ""
        echo "Try these steps to troubleshoot:"
        echo "  1. Check the log: cat startup/bootstrap.log"
        echo "  2. Check dependencies: node image-generator-cli.js status"
        echo "  3. Review the BACKEND_SETUP_GUIDE.md for help"
        exit $EXIT_CODE
    fi
}

# Run main function
main "$@"
