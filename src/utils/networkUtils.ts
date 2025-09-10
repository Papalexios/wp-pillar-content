/**
 * Advanced network utilities with enterprise-grade reliability
 */

// PERFORMANCE CACHE FOR REQUESTS
const requestCache = new Map<string, { data: any; timestamp: number; ttl: number }>();
const CACHE_TTL = 300000; // 5 minutes

const getCachedRequest = (key: string): any | null => {
  const cached = requestCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    console.log(`[Cache] HIT for key: ${key.substring(0, 50)}...`);
    return cached.data;
  }
  if (cached) {
    requestCache.delete(key);
  }
  return null;
};

const setCachedRequest = (key: string, data: any, ttl: number = CACHE_TTL) => {
  requestCache.set(key, { data, timestamp: Date.now(), ttl });
  
  // Cleanup old cache entries
  if (requestCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of requestCache.entries()) {
      if (now - v.timestamp > v.ttl) {
        requestCache.delete(k);
      }
    }
  }
};

/**
 * Fetches a URL using a series of CORS proxies as fallbacks. This makes
 * the sitemap crawling feature much more resilient to network errors or
 * individual proxy failures.
 * @param url The target URL to fetch.
 * @param options The options for the fetch call (method, headers, body).
 * @returns The successful Response object.
 * @throws {Error} if all proxies fail to fetch the URL.
 */
export const fetchWithProxies = async (url: string, options: RequestInit = {}): Promise<string> => {
    // Check cache first
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    const cached = getCachedRequest(cacheKey);
    if (cached) {
        return cached;
    }
    
    const encodedUrl = encodeURIComponent(url);
    const proxies = [
        // HIGH-PERFORMANCE PROXY CHAIN (8 tiers)
        `https://corsproxy.io/?${url}`,
        `https://api.allorigins.win/raw?url=${encodedUrl}`,
        `https://api.allorigins.win/raw?url=${encodedUrl}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
        `https://thingproxy.freeboard.io/fetch/${url}`,
        `https://proxy.cors.sh/${url}`,
        `https://api.codetabs.com/v1/tmp?quest=${encodedUrl}`,
        url // Direct request as final fallback
        `https://thingproxy.freeboard.io/fetch/${url}`,
        // Fallback: try direct request (works if CORS is properly configured)
        url
    ];

    let lastError: Error | null = null;
    
    // PARALLEL PROXY RACING (Instead of sequential)
    const racePromises = proxies.map(async (proxyUrl, index) => {
        try {
            console.log(`[NetworkUtils] Racing proxy ${index + 1}: ${proxyUrl.includes('://') ? new URL(proxyUrl).hostname : 'direct'}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(proxyUrl, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const text = await response.text();
                console.log(`[NetworkUtils] ✅ SUCCESS via proxy ${index + 1}`);
                
                // Cache successful response
                setCachedRequest(cacheKey, text);
                
                return text;
            }
            
            throw new Error(`Proxy request failed with status ${response.status}`);
        } catch (error) {
            console.warn(`[NetworkUtils] ❌ Proxy ${index + 1} failed:`, error);
            throw error;
        }
    });
    
    try {
        // Race all proxies - first successful response wins
        const result = await Promise.any(racePromises);
        return result;
    } catch (error) {
        const baseErrorMessage = "All proxy attempts failed. Network issues or website security blocking access.\n\n" +
            "Troubleshooting:\n" +
            "1. Check if your sitemap URL is publicly accessible\n" +
            "2. Verify website security settings aren't blocking proxy access\n" +
            "3. Confirm stable internet connection";

        throw new Error(lastError ? `${baseErrorMessage}\n\nDetailed Error: ${lastError.message}` : baseErrorMessage);
    }
};

/**
 * Processes items concurrently with a specified number of workers
 * @param items Array of items to process
 * @param processor Function to process each item
* @param concurrency Number of concurrent workers (default: 50)
 * @param onProgress Optional progress callback
 * @param shouldStop Optional stop condition
 */
export const processConcurrently = async <T>(
    items: T[],
    processor: (item: T, index: number) => Promise<void>, 
    concurrency = 50, // ULTRA-HIGH CONCURRENCY
    onProgress?: (completed: number, total: number) => void,
    shouldStop?: () => boolean
): Promise<void> => {
    const queue = [...items];
    let completed = 0;
    const total = items.length;
    
    // CONNECTION POOLING
    const activeWorkers = new Set<Promise<void>>();

    const worker = async (workerId: number) => {
        while (queue.length > 0) {
            if (shouldStop?.()) {
                queue.length = 0; // Clear queue to stop other workers
                break;
            }
            
            const item = queue.shift();
            if (item) {
                const index = total - queue.length - 1;
                try {
                    await processor(item, index);
                } catch (error) {
                    console.warn(`[ProcessConcurrently] Worker ${workerId} failed on item ${index}:`, error);
                }
                
                completed++;
                onProgress?.(completed, total);
            }
        }
    };

    // Create worker pool
    const workers = Array(concurrency).fill(null).map((_, i) => worker(i + 1));
    await Promise.all(workers);
};

/**
 * Smart retry function with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay in ms
 */
export const retryWithBackoff = async <T>( 
    fn: () => Promise<T>,
    maxRetries = 3,
    initialDelay = 1000
): Promise<T> => {
    const fnKey = fn.toString().substring(0, 50);
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error; // Last attempt, re-throw error
            }
            
            // INTELLIGENT BACKOFF WITH JITTER
            const baseDelay = initialDelay * Math.pow(2, attempt);
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;
            
            console.log(`[RetryWithBackoff] ${fnKey} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Retry attempts exhausted');
}