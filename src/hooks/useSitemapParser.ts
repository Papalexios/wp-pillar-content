import { useState, useCallback } from 'react';
import { SitemapEntry } from '../types';
import { fetchWithProxies } from '../utils/networkUtils';

interface UseSitemapParserResult {
  entries: SitemapEntry[];
  isLoading: boolean;
  progress: string;
  error: string | null;
  crawledCount: number;
  totalCount: number;
  discoverAndParseSitemap: (baseUrl: string, overridePath?: string) => Promise<void>;
}

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

  // PHASE 1: SITEMAP DISCOVERY AND URL COLLECTION
  const discoverAllUrls = async (initialUrl: string, overridePath?: string): Promise<Map<string, { lastMod: string }>> => {
    const sitemapQueue: string[] = [];
    const discoveredUrls = new Map<string, { lastMod: string }>();
    const processedSitemaps = new Set<string>();

    // Initialize queue with discovery URLs
    const baseUrl = new URL(initialUrl).origin;
    const paths = overridePath ? [overridePath] : [
      '/wp-sitemap.xml', 
      '/post-sitemap.xml', 
      '/sitemap_index.xml', 
      '/sitemap.xml',
      '/sitemap1.xml',
      '/page-sitemap.xml',
      '/wp-sitemap-posts-post-1.xml',
      '/wp-sitemap-posts-page-1.xml'
    ];
    
    // Add all potential sitemap URLs to queue
    for (const path of paths) {
      sitemapQueue.push(`${baseUrl}${path}`);
    }

    setProgress('🔍 PHASE 1: Quantum sitemap discovery initiated...');

    // Recursive sitemap processing loop with enterprise-grade resilience
    while (sitemapQueue.length > 0) {
      const currentSitemapUrl = sitemapQueue.shift()!;
      
      // Skip if already processed (prevents infinite loops)
      if (processedSitemaps.has(currentSitemapUrl)) {
        continue;
      }
      
      processedSitemaps.add(currentSitemapUrl);
      
      try {
        setProgress(`🚀 Quantum fetching: ${new URL(currentSitemapUrl).pathname}`);
        
        const xmlContent = await fetchWithProxies(currentSitemapUrl);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
        
        // Check for XML parsing errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
          console.warn(`XML parse error for ${currentSitemapUrl}:`, parseError.textContent);
          continue;
        }

        // Intelligent content detection with advanced XML parsing
        const sitemapElements = xmlDoc.querySelectorAll('sitemap loc, sitemapindex sitemap loc');
        const urlElements = xmlDoc.querySelectorAll('url, urlset url');

        if (sitemapElements.length > 0) {
          // This is a sitemap index - add child sitemaps to queue
          setProgress(`📚 Sitemap index discovered: ${sitemapElements.length} nested sitemaps found`);
          
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
              
              // Advanced URL filtering and de-duplication
              if (isValidContentUrl(pageUrl) && !discoveredUrls.has(pageUrl)) {
                discoveredUrls.set(pageUrl, { lastMod });
              }
            }
          });
        }

        setProgress(`✅ Processed ${processedSitemaps.size} sitemaps → ${discoveredUrls.size} unique URLs`);
        
      } catch (error) {
        console.warn(`Failed to process sitemap ${currentSitemapUrl}:`, error);
        continue; // Continue with next sitemap
      }
    }

    if (discoveredUrls.size === 0) {
      throw new Error(`No URLs found in any sitemaps. Processed ${processedSitemaps.size} sitemap files.`);
    }

    setProgress(`🎯 PHASE 1 COMPLETE: Discovered ${discoveredUrls.size} unique content URLs`);
    return discoveredUrls;
  };

  // Enhanced URL validation
  const isValidContentUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();
      
      // Exclude non-content URLs
      const excludePatterns = [
        '/wp-admin', '/wp-content', '/wp-includes', '/feed', '/comments',
        '/author', '/category', '/tag', '/attachment', '/search',
        '.xml', '.json', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif'
      ];
      
      return !excludePatterns.some(pattern => path.includes(pattern));
    } catch {
      return false;
    }
  };

  // PHASE 2: CONCURRENT PAGE ANALYSIS WITH QUANTUM PROCESSING
  const analyzePages = async (urlMap: Map<string, { lastMod: string }>) => {
    const urlEntries = Array.from(urlMap.entries());
    setTotalCount(urlEntries.length);
    setCrawledCount(0);
    
    setProgress(`⚡ PHASE 2: Quantum analysis of ${urlEntries.length} pages (50 concurrent workers)...`);

    const results: SitemapEntry[] = [];
    const processedUrls = new Set<string>(); // Prevent duplicates
    
    // Ultra-high concurrency processing (50 workers)
    await processConcurrently(urlEntries, 50, async (urlEntry, index) => {
      const [url, { lastMod }] = urlEntry;
      
      // Skip if already processed (additional safety)
      if (processedUrls.has(url)) {
        setCrawledCount(prev => prev + 1);
        return;
      }
      
      processedUrls.add(url);
      
      try {
        const analysis = await analyzeIndividualPage(url, lastMod);
        
        // Create sitemap entry with enhanced data
        const entry: SitemapEntry = {
          url: analysis.url,
          lastModified: analysis.lastModified,
          priority: calculatePriority(analysis),
          changeFreq: determineChangeFrequency(analysis),
          title: analysis.title,
          wordCount: analysis.wordCount,
          isStale: analysis.isStale,
          mainContent: analysis.mainContent.substring(0, 2000) // Store excerpt
        };

        results.push(entry);
        
        // Real-time UI update with progress
        setCrawledCount(prev => prev + 1);
        setProgress(`📊 Analyzed ${index + 1}/${urlEntries.length}: "${analysis.title}" (${analysis.wordCount} words)`);
        
        // Update entries in real-time for immediate UI feedback
        setEntries(prevEntries => {
          const newEntries = [...prevEntries];
          const existingIndex = newEntries.findIndex(e => e.url === entry.url);
          if (existingIndex >= 0) {
            newEntries[existingIndex] = entry;
          } else {
            newEntries.push(entry);
          }
          return newEntries;
        });
        
      } catch (error) {
        console.warn(`Failed to analyze ${url}:`, error);
        setCrawledCount(prev => prev + 1);
      }
    });

    return results;
  };

  // Advanced page analysis with intelligent content extraction
  const analyzeIndividualPage = async (url: string, lastMod: string): Promise<PageAnalysis> => {
    const htmlContent = await fetchWithProxies(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Smart title extraction with fallbacks
    let title = '';
    const titleElement = doc.querySelector('title');
    const h1Element = doc.querySelector('h1');
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    
    title = titleElement?.textContent?.trim() || 
            h1Element?.textContent?.trim() || 
            ogTitle?.getAttribute('content')?.trim() ||
            extractTitleFromUrl(url);

    // Intelligent main content extraction with priority scoring
    const contentSelectors = [
      'main article',
      'main .content',
      'main .post-content',
      'main .entry-content',
      '.main-content article',
      '.content-area article',
      '.post-content',
      '.entry-content',
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.single-post',
      '.post'
    ];

    let mainContentElement = null;
    for (const selector of contentSelectors) {
      const element = doc.querySelector(selector);
      if (element && element.textContent && element.textContent.trim().length > 100) {
        mainContentElement = element;
        break;
      }
    }

    if (!mainContentElement) {
      mainContentElement = doc.body;
    }

    // Remove noise elements with comprehensive cleaning
    const noiseSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.sidebar', '.menu', '.navigation', '.comments', '.comment',
      '.social-share', '.related-posts', '.advertisement', '.ads',
      '.cookie-notice', '.popup', '.modal', '.breadcrumb'
    ];

    noiseSelectors.forEach(selector => {
      const elements = mainContentElement!.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    // Extract and clean content
    const mainContent = mainContentElement.textContent || '';
    const cleanContent = mainContent.replace(/\s+/g, ' ').trim();
    
    // Accurate word count calculation
    const words = cleanContent.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;

    // Advanced staleness detection
    const currentYear = new Date().getFullYear();
    const yearMatches = title.match(/\b(19|20)\d{2}\b/g);
    const hasOldYear = yearMatches ? yearMatches.some(year => parseInt(year) < currentYear) : false;
    
    // Additional staleness indicators
    const staleIndicators = [
      'updated', 'last modified', 'published', 'copyright'
    ];
    const contentLower = cleanContent.toLowerCase();
    const hasStaleContent = staleIndicators.some(indicator => {
      const regex = new RegExp(`${indicator}\\s+(19|20)\\d{2}`, 'i');
      const matches = contentLower.match(regex);
      return matches && matches.some(match => {
        const year = parseInt(match.match(/(19|20)\d{2}/)?.[0] || '0');
        return year < currentYear;
      });
    });

    const isStale = hasOldYear || hasStaleContent;

    // Enhanced last modified date
    const lastModified = lastMod || new Date().toISOString();

    return {
      url,
      title: title.substring(0, 200), // Prevent overly long titles
      wordCount,
      lastModified,
      isStale,
      mainContent: cleanContent
    };
  };

  // Utility functions for enhanced analysis
  const calculatePriority = (analysis: PageAnalysis): number => {
    let priority = 0.5; // Default
    
    if (analysis.wordCount > 2000) priority += 0.2;
    if (analysis.wordCount > 1000) priority += 0.1;
    if (!analysis.isStale) priority += 0.1;
    if (analysis.title.toLowerCase().includes('guide') || 
        analysis.title.toLowerCase().includes('complete')) priority += 0.1;
    
    return Math.min(1.0, priority);
  };

  const determineChangeFrequency = (analysis: PageAnalysis): string => {
    const daysSinceModified = (Date.now() - new Date(analysis.lastModified).getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceModified < 7) return 'daily';
    if (daysSinceModified < 30) return 'weekly';
    if (daysSinceModified < 90) return 'monthly';
    return 'yearly';
  };

  // Ultra-fast concurrent processing with advanced worker pool
  const processConcurrently = async <T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<R>
  ): Promise<R[]> => {
    const results: R[] = [];
    let currentIndex = 0;
    
    const workers = Array(concurrency).fill(null).map(async () => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        if (index < items.length) {
          try {
            results[index] = await processor(items[index], index);
          } catch (error) {
            console.warn(`Worker failed on item ${index}:`, error);
          }
        }
      }
    });
    
    await Promise.all(workers);
    return results.filter(r => r !== undefined);
  };

  // Enhanced title extraction from URL
  const extractTitleFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'page';
      
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/\.(html|php|aspx?)$/i, '');
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
      // Phase 1: Quantum sitemap discovery
      const discoveredUrls = await discoverAllUrls(baseUrl, overridePath);
      
      setProgress(`🎯 PHASE 1 COMPLETE: ${discoveredUrls.size} unique URLs discovered`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 2: Concurrent quantum analysis
      await analyzePages(discoveredUrls);
      
      setProgress(`🚀 QUANTUM CRAWL COMPLETE: ${discoveredUrls.size} pages analyzed with military precision`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Quantum crawling protocol failed';
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