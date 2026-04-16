const esbuild = require('esbuild');

esbuild.build({
  entryPoints: [
    'assets/app-workspace.css',
    'assets/app.js',
    'assets/mesh-settings.css',
    'assets/mesh-docs.css'
  ],
  bundle: true,
  minify: true,
  outdir: 'assets/dist',
  sourcemap: true,
}).then(() => {
  console.log('Frontend assets bundled successfully to assets/dist/');
}).catch((err) => {
  console.error('Build failed', err);
  process.exit(1);
});
