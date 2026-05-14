/**
 * `berry-claw start` — start server + serve Web UI
 */
import { startServer } from '../server.js';

export async function runStart(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3210', 10);
  startServer(port);
  // startServer returns but keeps the process alive via HTTP server.
}
