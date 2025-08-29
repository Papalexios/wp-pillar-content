// Web Worker for heavy sitemap parsing operations
import { SitemapEntry } from '../types';

interface SitemapParseMessage {
  type: 'PARSE_SITEMAP';
  url: string;
  options?: {
    maxEntries?: number;
    filterPatterns?: string[];
  };
}

interface SitemapParseResult {
  type: 'SITEMAP_PARSED';
  entries: SitemapEntry[];
  totalCount: number;
  error?: string;
}

self.addEventListener('message', async (event: MessageEvent<SitemapParseMessage>) => {
  const { type, url, options = {} } = event.data;
  
  if (type !== 'PARSE_SITEMAP') return;

  try {
    // Post progress update
    self.postMessage({ type: 'PROGRESS', message: 'Fetching sitemap...' });
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
    }

    const xmlText = await response.text();
    
    // Post progress update
    self.postMessage({ type: 'PROGRESS', message: 'Parsing XML...' });
    
    const parser = new self.DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parsing errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid XML format');
    }

    // Extract entries
    const urlElements = xmlDoc.querySelectorAll('url');
    const entries: SitemapEntry[] = [];
    
    self.postMessage({ type: 'PROGRESS', message: `Processing ${urlElements.length} entries...` });

    for (let i = 0; i < urlElements.length; i++) {
      const urlElement = urlElements[i];
      const loc = urlElement.querySelector('loc')?.textContent;
      const lastmod = urlElement.querySelector('lastmod')?.textContent;
      const priority = urlElement.querySelector('priority')?.textContent;
      const changefreq = urlElement.querySelector('changefreq')?.textContent;

      if (!loc) continue;

      // Apply filters if specified
      if (options.filterPatterns && options.filterPatterns.length > 0) {
        const matchesFilter = options.filterPatterns.some(pattern => 
          loc.includes(pattern)
        );
        if (!matchesFilter) continue;
      }

      entries.push({
        url: loc,
        lastModified: lastmod || '',
        priority: priority ? parseFloat(priority) : 0.5,
        changeFreq: changefreq || 'weekly'
      });

      // Respect max entries limit
      if (options.maxEntries && entries.length >= options.maxEntries) {
        break;
      }

      // Update progress periodically
      if (i % 100 === 0) {
        const progress = Math.round((i / urlElements.length) * 100);
        self.postMessage({ type: 'PROGRESS', message: `Processing entries... ${progress}%` });
      }
    }

    const result: SitemapParseResult = {
      type: 'SITEMAP_PARSED',
      entries,
      totalCount: urlElements.length
    };

    self.postMessage(result);

  } catch (error) {
    const errorResult: SitemapParseResult = {
      type: 'SITEMAP_PARSED',
      entries: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    self.postMessage(errorResult);
  }
});

// Keep the worker alive
export {};