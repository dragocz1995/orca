import { writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) process.exit(2);
writeFileSync(file, 'E2E EDITOR DRAFT', 'utf8');
