import { mkdir, rm } from 'node:fs/promises';
import { build as viteBuild } from 'vite';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await viteBuild();
const result = await Bun.build({
  entrypoints: ['src/plugin.ts', 'src/cli.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  packages: 'bundle',
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
