import base from '../../artifacts/boostly-pro/vite.config';
import { mergeConfig } from '../../artifacts/boostly-pro/node_modules/vite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const serverRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(serverRoot, 'frontend-src/src');
const artifact = path.resolve(serverRoot, '../artifacts/boostly-pro');
const require = createRequire(path.join(artifact, 'package.json'));
const tailwind = require('tailwindcss/loadConfig')(path.join(artifact, 'tailwind.config.ts'));
export default mergeConfig(base, {
  css: { postcss: { plugins: [require('tailwindcss')({ ...tailwind,
    content: [...tailwind.content.map((glob: string) => path.resolve(artifact, glob)), path.join(sourceRoot, '**/*.{ts,tsx}')],
  }), require('autoprefixer')()] } },
  plugins: [{
    name: 'boostbotting-dashboard-patches', enforce: 'pre',
    resolveId(id: string) {
      const marker = '/artifacts/boostly-pro/src/';
      const index = id.indexOf(marker);
      const relative = id.startsWith('@/') ? id.slice(2) : index >= 0 ? id.slice(index + marker.length) : null;
      if (!relative) return;
      for (const suffix of ['', '.tsx', '.ts']) {
        const candidate = path.join(sourceRoot, relative + suffix);
        if (existsSync(candidate)) return candidate;
      }
    },
    load(id: string) {
      const marker = '/artifacts/boostly-pro/src/';
      const index = id.indexOf(marker);
      if (index < 0) return;
      const patch = path.join(sourceRoot, id.slice(index + marker.length));
      if (existsSync(patch)) return readFileSync(patch, 'utf8');
    },
  }],
  build: { outDir: path.join(serverRoot, 'frontend/public'), assetsDir: 'dashboard-assets', emptyOutDir: false },
});