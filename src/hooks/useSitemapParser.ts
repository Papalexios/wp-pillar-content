import { useState, useCallback } from 'react';
import { SitemapEntry } from '../types';

interface UseSitemapParserResult {
  entries: SitemapEntry[];
  isLoading: boolean;
  progress: string;
  error: string | null;
  discoverAndParseSitemap: (baseUrl: string, overridePath?: string, useProxy?: boolean) => Promise<void>;
}

const DEFAULT_SITEMAP_PATHS = ['/wp-sitemap.xml', '/post-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml'];

export const useSitemapParser = (): UseSitemapParserResult => {
  const [entries, setEntries] = useState<SitemapEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const discoverSitemapUrls = async (baseUrl: string, override?: string, useProxy: boolean = false): Promise<string> => {
    const paths = override ? [override, ...DEFAULT_SITEMAP_PATHS] : DEFAULT_SITEMAP_PATHS;
    
    for (const path of paths) {
      try {
        const fullUrl = useProxy 
          ? `/wp-api-proxy${path}?baseUrl=${encodeURIComponent(baseUrl)}`
          : `${baseUrl.replace(/\/$/, '')}${path}`;
          
        const res = await fetch(fullUrl, { 
          method: 'HEAD',
          ...(useProxy ? {} : {
            mode: 'cors',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          })
        });
        const contentType = res.headers.get('content-type') || '';
        
        if (res.ok && (contentType.includes('xml') || contentType.includes('text'))) {
          return useProxy 
            ? `/wp-api-proxy${path}?baseUrl=${encodeURIComponent(baseUrl)}`
            : fullUrl;
        }
      } catch (err) {
        // Continue to next path
        continue;
      }
    }
    
    throw new Error(`No sitemap found at ${baseUrl}. Tried paths: ${paths.join(', ')}`);
  };

  const loadSitemapXml = async (sitemapUrl: string, useProxy: boolean = false): Promise<Document> => {
    const res = await fetch(sitemapUrl, {
      ...(useProxy ? {} : {
        mode: 'cors',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap: ${res.statusText}`);
    }
    
    const xmlText = await res.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    
    // Check for parsing errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid XML format in sitemap');
    }
    
    return xmlDoc;
  };

  const extractUrls = (doc: Document): Array<{ loc: string; lastmod?: string }> => {
    const isIndex = doc.documentElement.localName === 'sitemapindex';
    
    if (isIndex) {
      // Handle sitemap index - get all sitemap locations
      return [...doc.querySelectorAll('sitemap > loc')]
        .map(node => ({
          loc: node.textContent?.trim() || '',
          lastmod: node.parentElement?.querySelector('lastmod')?.textContent?.trim()
        }))
        .filter(entry => entry.loc);
    } else {
      // Handle URL set - get all URL locations
      return [...doc.querySelectorAll('url')]
        .map(urlEl => ({
          loc: urlEl.querySelector('loc')?.textContent?.trim() || '',
          lastmod: urlEl.querySelector('lastmod')?.textContent?.trim()
        }))
        .filter(entry => entry.loc);
    }
  };

  const discoverAndParseSitemap = useCallback(async (baseUrl: string, overridePath?: string, useProxy: boolean = false) => {
    setIsLoading(true);
    setError(null);
    setProgress('Discovering sitemap...');
    
    try {
      // Step 1: Discover sitemap URL
      const sitemapUrl = await discoverSitemapUrls(baseUrl, overridePath, useProxy);
      setProgress('Loading sitemap XML...');
      
      // Step 2: Load and parse XML
      const xmlDoc = await loadSitemapXml(sitemapUrl, useProxy);
      setProgress('Extracting URLs...');
      
      // Step 3: Extract URLs
      const urlEntries = extractUrls(xmlDoc);
      
      // Step 4: Check if we have a sitemap index and need to fetch child sitemaps
      const isIndex = xmlDoc.documentElement.localName === 'sitemapindex';
      let allEntries: Array<{ loc: string; lastmod?: string }> = [];
      
      if (isIndex) {
        setProgress('Processing sitemap index...');
        
        // Fetch each child sitemap
        for (let i = 0; i < urlEntries.length; i++) {
          const sitemapUrl = urlEntries[i].loc;
          try {
            setProgress(`Loading child sitemap ${i + 1}/${urlEntries.length}...`);
            const childUrl = useProxy 
              ? `/wp-api-proxy${new URL(sitemapUrl).pathname}?baseUrl=${encodeURIComponent(baseUrl)}`
              : sitemapUrl;
            const childDoc = await loadSitemapXml(childUrl, useProxy);
            const childEntries = extractUrls(childDoc);
            allEntries = allEntries.concat(childEntries);
          } catch (err) {
            console.warn(`Failed to load child sitemap: ${sitemapUrl}`, err);
          }
        }
      } else {
        allEntries = urlEntries;
      }
      
      // Step 5: Convert to SitemapEntry format
      const sitemapEntries: SitemapEntry[] = allEntries.map(entry => ({
        url: entry.loc,
        lastModified: entry.lastmod || '',
        priority: 0.5,
        changeFreq: 'weekly'
      }));
      
      setEntries(sitemapEntries);
      setProgress(`Successfully loaded ${sitemapEntries.length} URLs from sitemap`);
      
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
    discoverAndParseSitemap
  };
};