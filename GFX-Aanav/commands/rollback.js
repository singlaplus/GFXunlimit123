const { rollback } = require('../core/aanav');
if (require.main === module) rollback(process.argv.slice(2)).then(code => process.exit(code)).catch(error => { console.error(error.stack || error.message); process.exit(1); });
