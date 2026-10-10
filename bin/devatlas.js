#!/usr/bin/env node
// Thin launcher: all logic lives in the bundled CLI next to this file.
import('../dist/cli/index.js').catch((error) => {
  console.error('DevAtlas failed to start:', error?.message ?? error);
  console.error('If you installed from source, run `npm run build` first.');
  process.exit(1);
});
