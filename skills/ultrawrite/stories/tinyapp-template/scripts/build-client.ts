// Builds the page: client/index.html into <outdir>, with Tailwind compiling
// 1st-Pouf's theme (the `bun build` command line loads no plugin, so it
// would leave @theme and @utility as written). Run from anywhere.
//
//   bun scripts/build-client.ts <outdir> [--minify]
import tailwind from 'bun-plugin-tailwind';
import {join, resolve} from 'node:path';

const ROOT = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const outdir = args.find((a) => !a.startsWith('--'));
if (!outdir) {
  console.error('usage: build-client.ts <outdir> [--minify]');
  process.exit(2);
}

process.chdir(ROOT);
const result = await Bun.build({
  entrypoints: ['./client/index.html'],
  outdir: resolve(process.cwd(), outdir),
  plugins: [tailwind],
  minify: args.includes('--minify'),
}).catch((e: unknown) => ({success: false, logs: [e]}));
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
