import http from 'node:http';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { createApp } from './app.ts';
import { attachRealtime } from './realtime-server.ts';
import { startJobs } from './jobs/index.ts';
import { ensureSeed } from './db/seed.ts';

db();
ensureSeed();
const app = createApp();
const server = http.createServer(app);
attachRealtime(server);
startJobs();
server.listen(config.port, () => {
  console.log(`Smart Parking server on :${config.port} (${config.env}) — public URL ${config.publicUrl}`);
});
