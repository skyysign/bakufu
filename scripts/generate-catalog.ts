// Prints original fictional catalog JSON. Redirect to a file to import through Admin.
import { writeFile } from 'node:fs/promises';
import { generateScaleCatalog } from '../packages/importers/src/scale';
const input = process.argv[2] ?? '1000';
if (!/^[0-9]+$/.test(input)) throw new Error('Use a character count from 12 to 1000.');
const text = JSON.stringify(generateScaleCatalog(Number(input)), null, 2) + '\n';
if (process.argv[3]) await writeFile(process.argv[3], text, 'utf8');
else process.stdout.write(text);
