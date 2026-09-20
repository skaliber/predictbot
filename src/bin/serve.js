#!/usr/bin/env node
/**
 * Entrypoint dedicat pentru server. Pornește necondiționat.
 *
 * Nu folosim garda `import.meta.url === file://${process.argv[1]}` în server.js:
 * sub PM2 nu se potrivește (wrapper-ul schimbă argv[1]), iar procesul pornea
 * fără să asculte pe niciun port.
 */
import { createApp } from '../server.js';
import config from '../config.js';
import log from '../lib/log.js';

const app = createApp();
const server = app.listen(config.server.port, () => {
  log.info('server_listening', { port: config.server.port, pid: process.pid });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log.info('server_shutdown', { signal });
    server.close(() => process.exit(0));
  });
}
