const axios = require('axios');

// Fetch current exchange rates from an API
async function fetchExchangeRates() {
  try {
    // Using exchangerate-api.com (free tier supports INR)
    // Alternative: https://api.exchangerate-api.com/v4/latest/INR
    const response = await axios.get('https://api.exchangerate-api.com/v4/latest/INR', {
      timeout: 10000
    });
    return response.data.rates;
  } catch (err) {
    console.error('Failed to fetch exchange rates:', err.message);
    return null;
  }
}

// Update currency exchange rates in database
async function updateCurrencyRates(pool, { force = false, fetchRates = fetchExchangeRates } = {}) {
  try {
    // Use passed pool or default to db module
    const poolRef = pool || require('../db');
    
    // Get current pricing settings
    const settingsRes = await poolRef.query('SELECT * FROM pricing_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows?.[0];

    if (!settings) {
      console.log('No pricing settings found');
      return null;
    }

    // Check if auto-update is enabled
    if (!force && !settings.auto_update_exchange_rate) {
      console.log('Auto-update exchange rate is disabled');
      return null;
    }

    const rates = await fetchRates();
    if (!rates) {
      console.log('Failed to fetch exchange rates from API');
      return null;
    }

    // Calculate exchange rate as INR/USD (how many INR per 1 USD)
    const exchangeRate = rates.USD ? (1 / rates.USD).toFixed(4) : null;

    if (!exchangeRate) {
      console.log('USD rate not available');
      return null;
    }

    // Updating rates must not overwrite fixed prices configured by the admin.
    const updateRes = await poolRef.query(
      `UPDATE pricing_settings 
       SET exchange_rate = $1,
           updated_at = now() 
       WHERE id = $2
       RETURNING *`,
      [exchangeRate, settings.id]
    );

    console.log(`✅ Currency rates updated at ${new Date().toISOString()}`);
    console.log(`Exchange Rate (INR/USD): ${exchangeRate}`);

    return updateRes.rows?.[0];
  } catch (err) {
    console.error('Currency scheduler error:', err.message);
  }
}

module.exports = { updateCurrencyRates };
