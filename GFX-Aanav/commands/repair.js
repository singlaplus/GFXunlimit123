const { repair } = require('../core/aanav');
if (require.main === module) repair().then(code => process.exit(code)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
