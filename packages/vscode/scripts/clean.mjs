import fs from 'fs';

for (const dir of ['dist', 'staging']) {
  fs.rmSync(dir, { recursive: true, force: true });
}
