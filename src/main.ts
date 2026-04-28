/**
 * Berry-Claw — Entry Point
 */
import { startServer } from './server.js';

const port = parseInt(process.env.PORT ?? '3210');
startServer(port).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
