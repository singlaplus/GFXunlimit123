'use strict';

const { Pool } = require('pg');

Pool.prototype.connect = function blockUnexpectedPostgresConnection() {
  return Promise.reject(new Error(
    'PostgreSQL access blocked by this database-free test guard; no connection was attempted.'
  ));
};
