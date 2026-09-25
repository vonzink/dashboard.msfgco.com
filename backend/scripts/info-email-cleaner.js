// Invoked by a systemd timer; no dotenv or IAM-user credentials are needed.
const { createInboxService } = require('../services/infoInbox');

createInboxService().clean({ dryRun: process.argv.includes('--dry-run') })
  .then(result => {
    console.log(JSON.stringify(result)); // Counts only: no message contents or addresses.
    if (result.failed) process.exitCode = 1;
  })
  .catch(error => {
    console.error(JSON.stringify({ error: error.name || 'Error', message: 'Email cleanup failed' }));
    process.exitCode = 1;
  });
