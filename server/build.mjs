// esbuild-based server build: transpile+minify all TS files in place.
// No bundling — imports are preserved so node_modules stays as-is at runtime.
import { build } from 'esbuild'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const entryPoints = walk(join(root, 'src'))

await build({
  entryPoints,
  outdir: join(root, 'dist'),
  outbase: join(root, 'src'),
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  bundle: false,
  sourcemap: false,
})

console.log(`esbuild: transpiled+minified ${entryPoints.length} files → dist/`)
