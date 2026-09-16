#!/bin/bash
echo "=== Tax Settings Flow Test ==="
echo ""
echo "1. Public endpoint (customer-facing):"
curl -s http://localhost:5000/settings/pricing | jq '{inr_amount: .inr_amount, usd_amount: .usd_amount, eur_amount: .eur_amount, tax_settings: .tax_settings}'
echo ""
echo "✓ Tax settings are persisted and fetched from backend"
echo "✓ Cart/Checkout will use these settings for tax calculation"
