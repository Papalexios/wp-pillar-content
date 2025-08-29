import { useState, useCallback } from 'react';
import { SitemapEntry } from '../types';

interface UseSitemapParserResult {
  entries: SitemapEntry[];
  isLoading: boolean;
  progress: string;
  error: string | null;
  parseSitemap: (url: string, options?: { maxEntries?: number; filterPatterns?: string[] }) => Promise<void>;
}

export const useSitemapParser = (): UseSitemapParserResult => {
  const [entries, setEntries] = useState<SitemapEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parseSitemap = useCallback(async (
    url: string, 
    options?: { maxEntries?: number; filterPatterns?: string[] }
  ) => {
    setIsLoading(true);
    setError(null);
    setProgress('Initializing...');
    
    try {
      // Create Web Worker
      const worker = new Worker(
        new URL('../workers/sitemapParser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      return new Promise<void>((resolve, reject) => {
        worker.onmessage = (event) => {
          const { type, entries: parsedEntries, totalCount, error: workerError, message } = event.data;
          
          if (type === 'PROGRESS') {
            setProgress(message);
          } else if (type === 'SITEMAP_PARSED') {
            if (workerError) {
              setError(workerError);
              reject(new Error(workerError));
            } else {
              setEntries(parsedEntries);
              setProgress(`Parsed ${parsedEntries.length} of ${totalCount} entries`);
              resolve();
            }
            setIsLoading(false);
            worker.terminate();
          }
        };

        worker.onerror = (err) => {
          setError('Worker error: ' + err.message);
          setIsLoading(false);
          worker.terminate();
          reject(err);
        };

        // Start the parsing process
        worker.postMessage({
          type: 'PARSE_SITEMAP',
          url,
          options
        });
      });
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    }
  }, []);

  return {
    entries,
    isLoading,
    progress,
    error,
    parseSitemap
  };
};