import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const source = new URL('../web/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = ['index.html', 'styles.css', 'app.js', 'demo-data.js'];
for (const file of files) {
  await cp(new URL(file, source), new URL(file, output));
}

const buildId = createHash('sha256')
  .update(Buffer.concat(await Promise.all(files.map((file) => readFile(new URL(file, source))))))
  .digest('hex')
  .slice(0, 12);
let html = await readFile(new URL('index.html', output), 'utf8');
for (const file of ['styles.css', 'runtime-config.js', 'demo-data.js', 'app.js']) {
  html = html.replaceAll(`/${file}"`, `/${file}?v=${buildId}"`);
}
await writeFile(new URL('index.html', output), html);
await writeFile(new URL('runtime-config.js', output), 'window.COLORTRACE_PUBLIC_DEMO = true;\n');
await writeFile(new URL('robots.txt', output), 'User-agent: *\nAllow: /\n');
