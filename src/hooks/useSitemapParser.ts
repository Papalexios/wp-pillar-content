import { useState, useCallback } from 'react';
import { SitemapEntry } from '../types';

interface UseSitemapParserResult {
  entries: SitemapEntry[];
  isLoading: boolean;
  progress: string;
  error: string | null;
  crawledCount: number;
  totalCount: number;
  discoverAndParseSitemap: (baseUrl: string, overridePath?: string) => Promise<void>;
}

// Professional CORS proxy rotation for maximum reliability
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://cors-anywhere.herokuapp.com/',
  'https://thingproxy.freeboard.io/fetch/',
  'https://crossorigin.me/',
  'https://cors.bridged.cc/',
];

const DEFAULT_SITEMAP_PATHS = [
  '/wp-sitemap.xml', 
  '/post-sitemap.xml', 
  '/sitemap_index.xml', 
  '/sitemap.xml',
  '/sitemap1.xml',
  '/page-sitemap.xml'
];

interface PageAnalysis {
  url: string;
  title: string;
  wordCount: number;
  lastModified: string;
  isStale: boolean;
  mainContent: string;
}

export const useSitemapParser = (): UseSitemapParserResult => {
  const [entries, setEntries] = useState<SitemapEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [crawledCount, setCrawledCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Advanced resilient fetching with proxy rotation
  const fetchWithProxies = async (url: string, retryCount = 0): Promise<string> => {
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxyUrl = `${CORS_PROXIES[i]}${encodeURIComponent(url)}`;
      
      try {
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache'
          },
          signal: AbortSignal.timeout(15000) // 15 second timeout
        });

        if (response.ok) {
          const text = await response.text();
          if (text && text.length > 50) { // Ensure we got meaningful content
            return text;
          }
        }
      } catch (error) {
        console.warn(`Proxy ${i + 1} failed for ${url}:`, error);
        continue; // Try next proxy
      }
    }

    // If all proxies failed and we haven't retried yet
    if (retryCount === 0) {
      console.log(`All proxies failed for ${url}, retrying once...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      return fetchWithProxies(url, 1);
    }

    throw new Error(`Failed to fetch ${url} through all available proxies`);
  };

  // Phase 1: Sitemap Discovery and URL Collection
  const discoverAllUrls = async (initialUrl: string, overridePath?: string): Promise<Map<string, { lastMod: string }>> => {
    const sitemapQueue: string[] = [];
    const discoveredUrls = new Map<string, { lastMod: string }>();
    const processedSitemaps = new Set<string>();

    // Initialize queue with discovery URLs
    const baseUrl = new URL(initialUrl).origin;
    const paths = overridePath ? [overridePath, ...DEFAULT_SITEMAP_PATHS] : DEFAULT_SITEMAP_PATHS;
    
    // Add all potential sitemap URLs to queue
    for (const path of paths) {
      sitemapQueue.push(`${baseUrl}${path}`);
    }

    setProgress('🔍 Phase 1: Discovering sitemaps and collecting URLs...');

    // Recursive sitemap processing loop
    while (sitemapQueue.length > 0) {
      const currentSitemapUrl = sitemapQueue.shift()!;
      
      // Skip if already processed (prevents infinite loops)
      if (processedSitemaps.has(currentSitemapUrl)) {
        continue;
      }
      
      processedSitemaps.add(currentSitemapUrl);
      
      try {
        setProgress(`📥 Fetching sitemap: ${new URL(currentSitemapUrl).pathname}`);
        
        const xmlContent = await fetchWithProxies(currentSitemapUrl);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
        
        // Check for XML parsing errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
          console.warn(`XML parse error for ${currentSitemapUrl}:`, parseError.textContent);
          continue;
        }

        // Intelligent content detection
        const sitemapElements = xmlDoc.querySelectorAll('sitemap loc');
        const urlElements = xmlDoc.querySelectorAll('url');

        if (sitemapElements.length > 0) {
          // This is a sitemap index - add child sitemaps to queue
          setProgress(`📚 Found sitemap index with ${sitemapElements.length} child sitemaps`);
          
          sitemapElements.forEach(locElement => {
            const childSitemapUrl = locElement.textContent?.trim();
            if (childSitemapUrl && !processedSitemaps.has(childSitemapUrl)) {
              sitemapQueue.push(childSitemapUrl);
            }
          });
        }

        if (urlElements.length > 0) {
          // This contains actual page URLs
          setProgress(`🔗 Processing ${urlElements.length} URLs from sitemap`);
          
          urlElements.forEach(urlElement => {
            const locElement = urlElement.querySelector('loc');
            const lastmodElement = urlElement.querySelector('lastmod');
            
            if (locElement?.textContent) {
              const pageUrl = locElement.textContent.trim();
              const lastMod = lastmodElement?.textContent?.trim() || new Date().toISOString();
              
              // De-duplication via Map
              if (!discoveredUrls.has(pageUrl)) {
                discoveredUrls.set(pageUrl, { lastMod });
              }
            }
          });
        }

        setProgress(`✅ Processed ${processedSitemaps.size} sitemaps, found ${discoveredUrls.size} unique URLs`);
        
      } catch (error) {
        console.warn(`Failed to process sitemap ${currentSitemapUrl}:`, error);
        continue; // Continue with next sitemap
      }
    }

    if (discoveredUrls.size === 0) {
      throw new Error(`No URLs found in any sitemaps. Processed ${processedSitemaps.size} sitemap files.`);
    }

    return discoveredUrls;
  };

  // Phase 2: Concurrent Page Analysis
  const analyzePages = async (urlMap: Map<string, { lastMod: string }>) => {
    const urlEntries = Array.from(urlMap.entries());
    setTotalCount(urlEntries.length);
    setCrawledCount(0);
    
    setProgress(`🚀 Phase 2: Analyzing ${urlEntries.length} pages with 8 concurrent workers...`);

    const results: SitemapEntry[] = [];
    
    // Concurrent processing with worker pool
    await processConcurrently(urlEntries, 8, async (urlEntry, index) => {
      const [url, { lastMod }] = urlEntry;
      
      try {
        const analysis = await analyzeIndividualPage(url, lastMod);
        
        // Create sitemap entry
        const entry: SitemapEntry = {
          url: analysis.url,
          lastModified: analysis.lastModified,
          priority: 0.5,
          changeFreq: 'weekly'
        };

        results.push(entry);
        
        // Live UI update
        setCrawledCount(prev => prev + 1);
        setProgress(`📊 Analyzed ${index + 1}/${urlEntries.length}: ${analysis.title} (${analysis.wordCount} words)`);
        
        // Update entries in real-time for immediate UI feedback
        setEntries(prevEntries => [...prevEntries, entry]);
        
      } catch (error) {
        console.warn(`Failed to analyze ${url}:`, error);
        setCrawledCount(prev => prev + 1);
      }
    });

    return results;
  };

  // Individual page analysis with intelligent content extraction
  const analyzeIndividualPage = async (url: string, lastMod: string): Promise<PageAnalysis> => {
    const htmlContent = await fetchWithProxies(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Extract title
    const titleElement = doc.querySelector('title');
    const title = titleElement?.textContent?.trim() || extractTitleFromUrl(url);

    // Intelligent content extraction - prioritize main content areas
    let mainContentElement = 
      doc.querySelector('main') ||
      doc.querySelector('article') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('.content') ||
      doc.querySelector('.post-content') ||
      doc.querySelector('.entry-content') ||
      doc.body;

    if (!mainContentElement) {
      mainContentElement = doc.body;
    }

    // Remove irrelevant elements
    const elementsToRemove = mainContentElement.querySelectorAll('script, style, nav, header, footer, aside, .sidebar, .menu, .navigation, .comments');
    elementsToRemove.forEach(el => el.remove());

    // Extract clean text content
    const mainContent = mainContentElement.textContent || '';
    const cleanContent = mainContent.replace(/\s+/g, ' ').trim();
    
    // Calculate word count
    const words = cleanContent.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;

    // Stale content detection - check for past years in title
    const currentYear = new Date().getFullYear();
    const yearMatches = title.match(/\b(19|20)\d{2}\b/g);
    const isStale = yearMatches ? yearMatches.some(year => parseInt(year) < currentYear) : false;

    // Age calculation
    const lastModified = lastMod || new Date().toISOString();

    return {
      url,
      title,
      wordCount,
      lastModified,
      isStale,
      mainContent: cleanContent
    };
  };

  // Concurrent processing utility (8 parallel workers)
  const processConcurrently = async <T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<R>
  ): Promise<R[]> => {
    const results: R[] = [];
    const executing: Promise<void>[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const promise = processor(items[i], i).then(result => {
        results[i] = result;
      });
      
      executing.push(promise);
      
      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p === promise), 1);
      }
    }
    
    await Promise.all(executing);
    return results;
  };

  // Extract title from URL fallback
  const extractTitleFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'page';
      
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/\.(html|php)$/i, '');
    } catch {
      return url;
    }
  };

  // Main discovery and parsing function
  const discoverAndParseSitemap = useCallback(async (baseUrl: string, overridePath?: string) => {
    setIsLoading(true);
    setError(null);
    setProgress('');
    setEntries([]); // Clear previous results
    setCrawledCount(0);
    setTotalCount(0);
    
    try {
      // Phase 1: Sitemap Discovery and URL Collection
      const discoveredUrls = await discoverAllUrls(baseUrl, overridePath);
      
      setProgress(`✅ Phase 1 Complete: Discovered ${discoveredUrls.size} unique URLs from all sitemaps`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause for UX
      
      // Phase 2: Concurrent Page Analysis
      await analyzePages(discoveredUrls);
      
      setProgress(`🎉 Crawl Complete: Successfully analyzed ${discoveredUrls.size} pages with full content extraction`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown crawling error occurred';
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
    crawledCount,
    totalCount,
    discoverAndParseSitemap
  };
};