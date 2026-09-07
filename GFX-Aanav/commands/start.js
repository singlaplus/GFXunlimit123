const { start } = require('../core/aanav');
if (require.main === module) start().then(code => process.exit(code)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
