const path = require('node:path');
const fs = require('node:fs');

function resolveClientUrl(app, dirname) {
  if (process.env.BERRY_CLAW_CLIENT_URL) {
    return process.env.BERRY_CLAW_CLIENT_URL;
  }

  if (!app.isPackaged) {
    return 'http://127.0.0.1:3211';
  }

  const packagedIndex = path.join(process.resourcesPath, 'client', 'index.html');
  if (fs.existsSync(packagedIndex)) {
    return `file://${packagedIndex}`;
  }

  const devIndex = path.resolve(dirname, '../../client/dist/index.html');
  return `file://${devIndex}`;
}

module.exports = { resolveClientUrl };
