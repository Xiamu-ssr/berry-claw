/**
 * Berry-Claw — Entry Point
 */
import { startServer } from './server.js';

const port = parseInt(process.env.PORT ?? '3210');
startServer(port);
