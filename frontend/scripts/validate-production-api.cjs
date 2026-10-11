process.env.NODE_ENV = 'production';
process.env.BABEL_ENV = 'production';

const { raw } = require('react-scripts/config/env');
const { getApiBaseUrl } = require('../src/utils/apiBaseUrl');

try {
  getApiBaseUrl({ ...process.env, ...raw, NODE_ENV: 'production' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
