const esbuild = require('esbuild');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

async function build() {
  // Build with esbuild
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    platform: 'node',
    target: 'node14',
  });

  // Create zip file
  const zip = new AdmZip();
  zip.addLocalFile('dist/index.js');

  // Add node_modules if necessary
  // zip.addLocalFolder('node_modules', 'node_modules');

  // Write the zip file
  zip.writeZip('dist/lambda-function.zip');

  console.log('Build complete. Output: dist/lambda-function.zip');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
