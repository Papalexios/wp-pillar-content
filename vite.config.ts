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
            target: wpOrigin,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/wp-api-proxy/, ''),
            secure: true,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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