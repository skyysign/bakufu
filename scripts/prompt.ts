import { createInterface } from 'node:readline/promises';

export async function promptText(label: string): Promise<string> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await input.question(label)).trim();
  } finally {
    input.close();
  }
}
export async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('A terminal is required for hidden password entry.');
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 256) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
