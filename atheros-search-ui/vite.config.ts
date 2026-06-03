import { defineConfig, loadEnv } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiConnectSrc = env.VITE_API_BASE ? ` ${env.VITE_API_BASE}` : '';

  return {
    plugins: [
      solidPlugin(),
      {
        name: 'html-csp-api-base',
        transformIndexHtml(html) {
          return html.replace('__API_CONNECT_SRC__', apiConnectSrc);
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
    },
    build: {
      target: 'esnext',
      sourcemap: true,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            router: ['@solidjs/router'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '~': '/src',
      },
    },
  };
});
