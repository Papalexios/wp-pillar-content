import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // WordPress origin for proxy - can be overridden by user config
    const wpOrigin = env.VITE_WP_ORIGIN || 'https://example.com';
    
    return {
      server: {
        proxy: {
          '/wp-api-proxy': {
            target: 'https://placeholder.com',
            changeOrigin: true,
            rewrite: (path) => {
              const url = new URL(path, 'http://localhost');
              const baseUrl = url.searchParams.get('baseUrl');
              const sitemap_path = path.split('?')[0].replace('/wp-api-proxy', '');
              return baseUrl ? `${baseUrl}${sitemap_path}` : sitemap_path;
            },
            configure: (proxy, _options) => {
              proxy.on('proxyReq', (proxyReq, req, res) => {
                const url = new URL(req.url || '', 'http://localhost');
                const baseUrl = url.searchParams.get('baseUrl');
                if (baseUrl) {
                  const target = new URL(baseUrl);
                  proxyReq.setHeader('host', target.host);
                }
              });
            }
          },
        }
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});