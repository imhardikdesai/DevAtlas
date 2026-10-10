/**
 * Executable entry point. Kept separate from main.ts so tests can import the
 * argument parser and command dispatcher without starting a server.
 */
import { main } from '@/cli/main';

process.exitCode = await main();
