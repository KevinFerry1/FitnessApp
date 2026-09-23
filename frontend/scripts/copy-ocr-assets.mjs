import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const publicDir = resolve('public/ocr');
const workerSource = dirname(require.resolve('tesseract.js/package.json'));
const coreSource = dirname(require.resolve('tesseract.js-core/package.json'));

mkdirSync(join(publicDir, 'core'), { recursive: true });
for (const filename of ['worker.min.js', 'worker.min.js.LICENSE.txt']) {
  copyFileSync(join(workerSource, 'dist', filename), join(publicDir, filename));
}
for (const variant of ['', '-simd', '-relaxedsimd']) {
  const name = `tesseract-core${variant}-lstm.wasm`;
  for (const filename of [name, `${name}.js`]) {
    copyFileSync(join(coreSource, filename), join(publicDir, 'core', filename));
  }
}
copyFileSync(join(coreSource, 'LICENSE'), join(publicDir, 'core', 'LICENSE'));
