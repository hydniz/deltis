import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
let commitHash = 'unknown';
try { commitHash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}

export default defineConfig(({ mode }) => {
  const base = pkg.stage ? `${pkg.version}-${pkg.stage}` : pkg.version;
  const APP_VERSION = mode === 'production' ? base : `${base}+${commitHash}`;

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    server: {
      host: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        }
      }
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/tests/setup.js'],
      css: false,
      environmentOptions: {
        jsdom: {
          url: 'http://localhost/',
        },
      },
    }
  };
});
