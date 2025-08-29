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
    setProgress('Fetching sitemap...');
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
      }

      const xmlText = await response.text();
      setProgress('Parsing XML...');
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // Check for parsing errors
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        throw new Error('Invalid XML format');
      }

      // Extract entries
      const urlElements = xmlDoc.querySelectorAll('url');
      const parsedEntries: SitemapEntry[] = [];
      
      setProgress(`Processing ${urlElements.length} entries...`);

      for (let i = 0; i < urlElements.length; i++) {
        const urlElement = urlElements[i];
        const loc = urlElement.querySelector('loc')?.textContent;
        const lastmod = urlElement.querySelector('lastmod')?.textContent;
        const priority = urlElement.querySelector('priority')?.textContent;
        const changefreq = urlElement.querySelector('changefreq')?.textContent;

        if (!loc) continue;

        // Apply filters if specified
        if (options?.filterPatterns && options.filterPatterns.length > 0) {
          const matchesFilter = options.filterPatterns.some(pattern => 
            loc.includes(pattern)
          );
          if (!matchesFilter) continue;
        }

        parsedEntries.push({
          url: loc,
          lastModified: lastmod || '',
          priority: priority ? parseFloat(priority) : 0.5,
          changeFreq: changefreq || 'weekly'
        });

        // Respect max entries limit
        if (options?.maxEntries && parsedEntries.length >= options.maxEntries) {
          break;
        }

        // Update progress periodically
        if (i % 100 === 0) {
          const progressPercent = Math.round((i / urlElements.length) * 100);
          setProgress(`Processing entries... ${progressPercent}%`);
        }
      }

      setEntries(parsedEntries);
      setProgress(`Successfully parsed ${parsedEntries.length} entries`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
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