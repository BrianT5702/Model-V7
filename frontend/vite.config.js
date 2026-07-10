import { writeFileSync } from 'fs';
import { join } from 'path';
import { defineConfig, loadEnv, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

/** Keep existing REACT_APP_* reads working without renaming env vars. */
function buildProcessEnvDefines(mode, env) {
  const defines = {
    'process.env.NODE_ENV': JSON.stringify(mode),
  };
  Object.entries(env).forEach(([key, value]) => {
    if (key.startsWith('REACT_APP_')) {
      defines[`process.env.${key}`] = JSON.stringify(value);
    }
  });
  return defines;
}

/** CRA used .js for JSX — teach Vite/Rollup to parse src .js files as JSX. */
function treatJsFilesAsJsx() {
  return {
    name: 'treat-js-files-as-jsx',
    async transform(code, id) {
      if (!/\/src\/.*\.js$/.test(id)) return null;
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic',
      });
    },
  };
}

/** deploy.sh / publish.ps1 / Django react_assets expect CRA-style asset-manifest.json */
function craAssetManifest(outDir) {
  let mainJs = '';
  let mainCss = '';
  return {
    name: 'cra-asset-manifest',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/^static\/js\/main\.[^/]+\.js$/.test(fileName)) mainJs = fileName;
        if (/^static\/css\/main\.[^/]+\.css$/.test(fileName)) mainCss = fileName;
      }
    },
    closeBundle() {
      if (!mainJs) {
        console.warn('cra-asset-manifest: main.js not found in bundle');
        return;
      }
      const manifest = {
        files: {
          'main.js': `/${mainJs}`,
          'index.html': '/index.html',
        },
        entrypoints: [mainJs],
      };
      if (mainCss) {
        manifest.files['main.css'] = `/${mainCss}`;
        manifest.entrypoints.push(mainCss);
      }
      writeFileSync(
        join(process.cwd(), outDir, 'asset-manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const outDir = process.env.BUILD_PATH || 'dist';
  return {
    plugins: [treatJsFilesAsJsx(), react({ include: /\.(jsx|js)$/ }), craAssetManifest(outDir)],
    envPrefix: ['VITE_', 'REACT_APP_'],
    define: buildProcessEnvDefines(mode, env),
    server: {
      host: '127.0.0.1',
      port: 3001,
      strictPort: false,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2020',
      rollupOptions: {
        output: {
          entryFileNames: 'static/js/main.[hash].js',
          chunkFileNames: 'static/js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            if (name.endsWith('.css')) {
              return 'static/css/main.[hash][extname]';
            }
            return 'static/media/[name].[hash][extname]';
          },
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
        },
      },
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'axios',
        'three',
        'fabric',
        'jspdf',
        'html2canvas',
        'gsap',
      ],
    },
  };
});
