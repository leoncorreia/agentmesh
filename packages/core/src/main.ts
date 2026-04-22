import { start } from './index.js';

void start().catch((err) => {
  console.error(err);
  process.exit(1);
});
