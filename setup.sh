#!/bin/bash

# Stocksite Setup Script Wrapper
# This script provides an easy way to run the setup from the command line

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Display help if requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    cat << EOF
Stocksite System Setup & Verification

Usage: ./setup.sh [command]

Commands:
  (no args)     - Full setup and verification
  repair        - Repair corrupted installation
  check         - Check system without installing
  start         - Setup and start backend server
  help          - Show this help message

Examples:
  ./setup.sh                # Full setup
  ./setup.sh repair         # Repair installation
  ./setup.sh check          # Check only
  ./setup.sh start          # Setup and start backend

Or use npm:
  npm run setup             # Full setup
  npm run setup:repair      # Repair installation
  npm run setup:check       # Check only
  npm run setup:start       # Setup and start backend

EOF
    exit 0
fi

# Convert arguments to format expected by setup.js
case "$1" in
    repair)
        node "$SCRIPT_DIR/setup.js" --repair
        ;;
    check)
        node "$SCRIPT_DIR/setup.js" --check-only
        ;;
    start)
        node "$SCRIPT_DIR/setup.js" --start
        ;;
    *)
        node "$SCRIPT_DIR/setup.js" "$@"
        ;;
esac
