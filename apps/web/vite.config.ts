import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${env.PORT || '3000'}` },
    },
  };
});
