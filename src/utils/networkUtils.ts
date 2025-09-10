/**
 * Advanced network utilities with enterprise-grade reliability
 */

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
    const encodedUrl = encodeURIComponent(url);
    const proxies = [
        // High-performance proxy servers with different approaches
        `https://corsproxy.io/?${url}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
        `https://api.allorigins.win/raw?url=${encodedUrl}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
        `https://thingproxy.freeboard.io/fetch/${url}`,
        // Fallback: try direct request (works if CORS is properly configured)
        url
    ];

    let lastError: Error | null = null;

    for (const proxyUrl of proxies) {
        try {
            console.log(`[NetworkUtils] Attempting fetch via: ${proxyUrl.includes('://') ? new URL(proxyUrl).hostname : 'direct'}`);
            
            const response = await fetch(proxyUrl, {
                ...options,
                signal: AbortSignal.timeout(15000), // 15 second timeout
            });
            
            if (response.ok) {
                const text = await response.text();
                console.log(`[NetworkUtils] ✅ Success via ${proxyUrl.includes('://') ? new URL(proxyUrl).hostname : 'direct'}`);
                return text;
            }
            
            lastError = new Error(`Proxy request failed with status ${response.status} for ${proxyUrl}`);
        } catch (error) {
            console.warn(`[NetworkUtils] ❌ Failed via ${proxyUrl}:`, error);
            lastError = error as Error;
            continue; // Try next proxy
        }
    }

    // If we're here, all proxies failed
    const baseErrorMessage = "Failed to crawl your sitemap. This is often due to network issues or website security blocking proxy access.\n\n" +
        "Please check that:\n" +
        "1. Your sitemap URL is correct and publicly accessible\n" +
        "2. Your website's security settings aren't blocking proxy access\n" +
        "3. Your internet connection is stable";

    throw new Error(lastError ? `${baseErrorMessage}\n\nLast Error: ${lastError.message}` : baseErrorMessage);
};

/**
 * Processes items concurrently with a specified number of workers
 * @param items Array of items to process
 * @param processor Function to process each item
 * @param concurrency Number of concurrent workers (default: 8)
 * @param onProgress Optional progress callback
 * @param shouldStop Optional stop condition
 */
export const processConcurrently = async <T>(
    items: T[],
    processor: (item: T, index: number) => Promise<void>,
    concurrency = 8,
    onProgress?: (completed: number, total: number) => void,
    shouldStop?: () => boolean
): Promise<void> => {
    const queue = [...items];
    let completed = 0;
    const total = items.length;

    const worker = async () => {
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
                    console.warn(`[ProcessConcurrently] Worker failed on item ${index}:`, error);
                }
                
                completed++;
                onProgress?.(completed, total);
            }
        }
    };

    // Create worker pool
    const workers = Array(concurrency).fill(null).map(() => worker());
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
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error; // Last attempt, re-throw error
            }
            
            const delay = initialDelay * Math.pow(2, attempt);
            console.log(`[RetryWithBackoff] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Retry attempts exhausted');
};