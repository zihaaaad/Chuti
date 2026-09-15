'use strict';

// Writes cloud-config.json (bundled into the desktop app) from environment
// variables set in CI. Providers without a registration are left out.
const fs = require('fs');
const path = require('path');

const config = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  config.google = { clientId: process.env.GOOGLE_CLIENT_ID.trim(), clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim() };
}
if (process.env.ONEDRIVE_CLIENT_ID) {
  config.onedrive = { clientId: process.env.ONEDRIVE_CLIENT_ID.trim() };
}

fs.writeFileSync(path.join(__dirname, '..', 'cloud-config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`cloud-config.json: ${Object.keys(config).join(', ') || 'no providers configured'}`);
