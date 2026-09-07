const { status } = require('../core/aanav');
if (require.main === module) { try { process.exit(status()); } catch (error) { console.error(error.stack || error.message); process.exit(1); } }
