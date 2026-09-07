const { runCheck } = require('../core/aanav');
if (require.main === module) runCheck().then(data => process.exit(data.result === 'PASS' ? 0 : 1)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
