import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // Fail fast if WordPress origin not provided
    const wpOrigin = env.VITE_WP_ORIGIN || 'https://mysticaldigits.com';
    
    return {
      server: {
        proxy: {
          '/wp-sitemap-proxy': {
            target: wpOrigin,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/wp-sitemap-proxy/, ''),
            secure: true,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }
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