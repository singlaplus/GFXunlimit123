const { save } = require('../core/aanav');
if (require.main === module) save().then(code => process.exit(code)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
