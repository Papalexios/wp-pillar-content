
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import React, { useState, useMemo, useEffect, useCallback, useReducer, useRef, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';

// Debounce function to limit how often a function gets called
const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

/**
 * Returns a random subset of an array using the Fisher-Yates shuffle algorithm.
 * @param array The source array.
 * @param size The size of the random subset to return.
 * @returns A new array containing the random subset.
 */
const getRandomSubset = (array, size) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, size);
};


/**
 * Extracts a JSON object from a string that might be wrapped in markdown,
 * have leading/trailing text, or other common AI response artifacts.
 * @param text The raw string response from the AI.
 * @returns The clean JSON string.
 * @throws {Error} if a valid JSON object cannot be found.
 */
const extractJson = (text: string): string => {
    // 1. Look for a JSON markdown block
    const markdownMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[1]) {
        try {
            JSON.parse(markdownMatch[1].trim());
            return markdownMatch[1].trim();
        } catch (e) {
            // Fall through if markdown content is not valid JSON
        }
    }

    // 2. If no markdown, find the first '{' or '[' and last '}' or ']'
    const firstBracket = text.indexOf('{');
    const lastBracket = text.lastIndexOf('}');
    const firstSquare = text.indexOf('[');
    const lastSquare = text.lastIndexOf(']');

    let start = -1;
    let end = -1;

    if (firstBracket !== -1 && lastBracket > firstBracket) {
        start = firstBracket;
        end = lastBracket;
    }
    
    // Check if a square bracket JSON array is more likely
    if (firstSquare !== -1 && lastSquare > firstSquare && (start === -1 || firstSquare < start)) {
        start = firstSquare;
        end = lastSquare;
    }


    if (start !== -1 && end > start) {
        return text.substring(start, end + 1);
    }

    throw new Error("Could not find a valid JSON object in the AI response.");
};


/**
 * A professional, state-of-the-art promise queue processor.
 * It executes a series of promise-returning functions sequentially with a delay,
 * preventing API rate-limiting issues and provides progress updates.
 * @param items The array of items to process.
 * @param promiseFn The function that takes an item and returns a promise.
 * @param onProgress Optional callback to report progress for each item.
 * @param delay The delay in ms between each promise execution.
 */
const processPromiseQueue = async (items, promiseFn, onProgress, delay = 1000) => {
    const results = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            const result = await promiseFn(item);
            results.push({ status: 'fulfilled', value: result });
            if (onProgress) onProgress({ item, result, index: i, success: true });
        } catch (error) {
            results.push({ status: 'rejected', reason: error });
            if (onProgress) onProgress({ item, error, index: i, success: false });
        }
        if (i < items.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return results;
};

/**
 * Wraps an async function with a robust retry mechanism. It retries on any failure,
 * using exponential backoff for API rate-limiting errors (HTTP 429) and a short,
 * constant delay for other transient errors (e.g., network issues, JSON parsing).
 * @param apiCallFn The async function to call, which should handle the entire process
 * including parsing and validation, throwing an error on failure.
 * @param maxRetries The maximum number of retries before giving up.
 * @param initialDelay The initial delay in ms for the first rate-limit retry.
 * @returns A Promise that resolves with the result of the `apiCallFn`.
 */
const makeResilientAiCall = async <T,>(
    apiCallFn: () => Promise<T>, 
    maxRetries: number = 3, 
    initialDelay: number = 2000
): Promise<T> => {
    let lastError: Error | null = null;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCallFn();
        } catch (error: any) {
            lastError = error;
            if (i >= maxRetries - 1) {
                console.error(`AI call failed on final attempt (${maxRetries}).`, error);
                throw error; // Throw after final attempt
            }

            const isRateLimitError = (
                (error.status === 429) || 
                (error.message && error.message.includes('429')) ||
                (error.message && error.message.toLowerCase().includes('rate limit'))
            );

            let delay = 1000; // Default delay for non-rate-limit errors
            if (isRateLimitError) {
                delay = initialDelay * Math.pow(2, i) + Math.random() * 1000;
                console.warn(`Rate limit error detected. Retrying in ${Math.round(delay / 1000)}s... (Attempt ${i + 1}/${maxRetries})`);
            } else {
                 console.warn(`AI call failed. Retrying in ${delay/1000}s... (Attempt ${i + 1}/${maxRetries})`, error.message);
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    // This part should be unreachable if maxRetries > 0, but is a good fallback.
    throw new Error(`AI call failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};


/**
 * Intelligently fetches a public resource (e.g., sitemap) by first attempting a direct connection.
 * If the direct connection fails due to a CORS-like network error, it automatically
 * falls back to a series of reliable CORS proxies. **Primarily intended for public GET requests.**
 * @param url The target URL to fetch.
 * @param options The standard fetch options object.
 * @returns A Promise that resolves with the Response object.
 */
const smartFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) return directResponse;
        console.warn(`Direct fetch to ${url} was not OK, status: ${directResponse.status}. Trying proxies.`);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            console.warn(`Direct fetch to ${url} failed, likely due to CORS. Falling back to proxies.`);
        } else {
            console.error('An unexpected network error occurred during direct fetch:', error);
            throw error;
        }
    }

    const proxies = [
        { name: 'corsproxy.io', buildUrl: (targetUrl) => `https://corsproxy.io/?${targetUrl}`},
        { name: 'allorigins.win', buildUrl: (targetUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`},
        { name: 'thingproxy.freeboard.io', buildUrl: (targetUrl) => `https://thingproxy.freeboard.io/fetch/${targetUrl}`},
        { name: 'CodeTabs', buildUrl: (targetUrl) => `https://api.codetabs.com/v1/proxy?quest=${targetUrl}`}
    ];
    let lastError: Error | null = new Error('No proxies were attempted.');

    for (const proxy of proxies) {
        try {
            const proxyResponse = await fetch(proxy.buildUrl(url), options);
            if (proxyResponse.ok) {
                console.log(`Successfully fetched via proxy: ${proxy.name}`);
                return proxyResponse;
            }
            lastError = new Error(`Proxy ${proxy.name} returned status ${proxyResponse.status}`);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    console.error("All proxies failed.", lastError);
    throw new Error(`All proxies failed to fetch the resource. Last error: ${lastError.message}`);
};

/**
 * Performs a direct fetch request without proxy fallbacks.
 * Provides a more informative error message for common CORS issues,
 * which is crucial for authenticated API calls where proxies are not suitable.
 * @param url The target URL to fetch.
 * @param options The standard fetch options object.
 * @returns A Promise that resolves with the Response object.
 */
const directFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            throw new Error(
                "A network error occurred, likely due to a CORS policy on your server. " +
                "Please ensure your WordPress URL is correct and that your server is configured to accept requests from this origin. " +
                "Using a browser extension to disable CORS can be a temporary workaround for development."
            );
        }
        throw error;
    }
};

/**
 * Recursively parses a sitemap or sitemap index to extract all unique URLs.
 * @param url The URL of the sitemap or sitemap index.
 * @param visited A Set to keep track of visited sitemap URLs to prevent infinite loops.
 * @returns A Promise resolving to an array of all found URLs.
 */
const parseSitemap = async (url: string, visited: Set<string> = new Set()): Promise<string[]> => {
    if (visited.has(url)) return [];
    visited.add(url);

    try {
        const response = await smartFetch(url);
        if (!response.ok) {
            console.error(`Failed to fetch sitemap/index at ${url}. Status: ${response.status}`);
            return []; // Fail gracefully for this URL
        }
        
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "application/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            console.error(`XML parsing error for ${url}`);
            return [];
        }

        const isSitemapIndex = xmlDoc.getElementsByTagName('sitemapindex').length > 0;
        if (isSitemapIndex) {
            const sitemapUrls = Array.from(xmlDoc.getElementsByTagName('loc')).map(node => node.textContent).filter(Boolean) as string[];
            const promises = sitemapUrls.map(sitemapUrl => parseSitemap(sitemapUrl, visited));
            const results = await Promise.all(promises);
            return results.flat();
        }

        const isUrlset = xmlDoc.getElementsByTagName('urlset').length > 0;
        if (isUrlset) {
            return Array.from(xmlDoc.getElementsByTagName('loc')).map(node => node.textContent).filter(Boolean) as string[];
        }
        
        console.warn(`No <sitemapindex> or <urlset> found in ${url}.`);
        return [];

    } catch (error) {
        console.error(`Error processing sitemap URL ${url}:`, error);
        return [];
    }
};

/**
 * Performs real-time SERP analysis for a given keyword using the Serper.dev API.
 * It fetches top competitors, scrapes their content for word count and headings,
 * and extracts "People Also Ask" and "Related Searches" to inform AI content generation.
 * @param keyword The target keyword for analysis.
 * @param apiKey The Serper.dev API key.
 * @returns A promise resolving to a structured analysis object.
 */
const analyzeSERP = async (keyword: string, apiKey: string) => {
    // 1. Fetch SERP data from Serper.dev
    const serpResponse = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: keyword, num: 5 }) // Fetch top 5 results for efficiency
    });
    if (!serpResponse.ok) {
        const errorData = await serpResponse.json();
        throw new Error(`SERP API Error: ${errorData.message || serpResponse.statusText}`);
    }
    const serpData = await serpResponse.json();

    const topCompetitors = serpData.organic?.slice(0, 5) || [];
    if (topCompetitors.length === 0) {
        console.warn("No organic results found from SERP API for keyword:", keyword);
        // Return reasonable defaults to allow generation to continue
        return { averageWordCount: 1800, averageH2Count: 8, averageH3Count: 12, commonHeadings: [], peopleAlsoAsk: [], relatedSearches: [], competitorUrls: [] };
    }

    // 2. Scrape and analyze each competitor
    const scrapePromises = topCompetitors.map(async (competitor) => {
        try {
            const response = await smartFetch(competitor.link);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const mainContent = doc.querySelector('main') || doc.querySelector('article') || doc.body;
            
            mainContent.querySelectorAll('script, style, nav, footer, header, aside, form, iframe').forEach(el => el.remove());
            
            const textContent = mainContent.innerText || '';
            const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
            
            const headings = Array.from(mainContent.querySelectorAll('h2, h3')).map(h => h.textContent?.trim()).filter(Boolean) as string[];
            const h2Count = mainContent.querySelectorAll('h2').length;
            const h3Count = mainContent.querySelectorAll('h3').length;

            return { wordCount, headings, h2Count, h3Count, link: competitor.link };
        } catch (error) {
            console.warn(`Failed to scrape ${competitor.link}:`, error);
            return null; // Fail gracefully for individual scrapes
        }
    });

    const scrapedResults = (await Promise.all(scrapePromises)).filter(Boolean);

    // 3. Aggregate and process the scraped data
    let totalWordCount = 0;
    let totalH2Count = 0;
    let totalH3Count = 0;
    const allHeadings: { [key: string]: number } = {};
    
    scrapedResults.forEach(result => {
        if (result.wordCount > 50) { // Filter out pages with very little content
            totalWordCount += result.wordCount;
            totalH2Count += result.h2Count;
            totalH3Count += result.h3Count;
            result.headings.forEach(heading => {
                const cleanedHeading = heading.toLowerCase().trim();
                if(cleanedHeading.length > 5 && cleanedHeading.length < 100) { // Filter out noisy headings
                    allHeadings[cleanedHeading] = (allHeadings[cleanedHeading] || 0) + 1;
                }
            });
        }
    });
    
    const validScrapes = scrapedResults.filter(r => r.wordCount > 50).length;
    const averageWordCount = validScrapes > 0 ? Math.round(totalWordCount / validScrapes) : 1800;
    const averageH2Count = validScrapes > 0 ? Math.round(totalH2Count / validScrapes) : 8;
    const averageH3Count = validScrapes > 0 ? Math.round(totalH3Count / validScrapes) : 12;

    const commonHeadings = Object.entries(allHeadings)
        .filter(([_, count]) => count > 1) // Only include headings that appear more than once for relevance
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10) // Top 10 most common headings
        .map(([heading, _]) => heading.replace(/\b\w/g, l => l.toUpperCase())); // Capitalize for presentation
        
    const competitorUrls = scrapedResults.map(r => r.link);

    return {
        averageWordCount,
        averageH2Count,
        averageH3Count,
        commonHeadings,
        peopleAlsoAsk: serpData.peopleAlsoAsk?.map(p => p.question) || [],
        relatedSearches: serpData.relatedSearches?.map(r => r.query) || [],
        competitorUrls,
    };
};


const slugToTitle = (url: string): string => {
    try {
        const path = new URL(url).pathname;
        if (path === '/blog/') return 'Affiliate Marketing Blog';
        const title = path.replace(/^\/|\/$/g, '').split('/').pop()?.replace(/-/g, ' ') || '';
        return title.replace(/\b\w/g, l => l.toUpperCase());
    } catch (e) {
        return url;
    }
};

const normalizeWpUrl = (url: string): string => {
    if (!url || url.trim() === '') return '';
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`;
    }
    return normalized.replace(/\/+$/, ""); // Remove trailing slashes
};

const ProgressBar = ({ currentStep }: { currentStep: number }) => {
    const steps = ['Config', 'Content Strategy', 'Review & Publish'];
    return (
        <ol className="progress-bar">
            {steps.map((name, index) => {
                const stepIndex = index + 1;
                const status = stepIndex < currentStep ? 'completed' : stepIndex === currentStep ? 'active' : '';
                return (
                    <li key={name} className={`progress-step ${status}`}>
                        <div className="step-circle">{stepIndex < currentStep ? '✔' : stepIndex}</div>
                        <span className="step-name">{name}</span>
                    </li>
                );
            })}
        </ol>
    );
};

const ApiKeyValidator = ({ status }) => {
    if (status === 'validating') return <div className="key-status-icon"><div className="key-status-spinner"></div></div>;
    if (status === 'valid') return <div className="key-status-icon success"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg></div>;
    if (status === 'invalid') return <div className="key-status-icon error"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></div>;
    return null;
};

const Feature = ({ icon, title, children }) => (
    <div className="feature">
        <div className="feature-icon">{icon}</div>
        <div className="feature-content">
            <h3>{title}</h3>
            <p>{children}</p>
        </div>
    </div>
);

const PromotionalLinks = () => {
    const linksToShow = useMemo(() => getRandomSubset(PROMOTIONAL_LINKS, 4), []);

    return (
        <div className="promo-links-section">
            <h3>Explore Our Expertise</h3>
            <p>Check out some of our top-performing content at affiliatemarketingforsuccess.com.</p>
            <div className="promo-links-grid">
                {linksToShow.map(url => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="promo-link-card">
                        <h4>{slugToTitle(url)}</h4>
                        <span>affiliatemarketingforsuccess.com</span>
                    </a>
                ))}
            </div>
        </div>
    );
};

const LandingPageIntro = () => (
    <div className="landing-intro">
        <h2 className="usp-headline">The AI Strategist that builds your content empire, from keyword to #1 ranking.</h2>
        <p className="usp-subheadline">
            Go beyond generic AI writing. We analyze your entire site to build a data-driven content strategy, creating interconnected articles engineered to dominate search rankings.
        </p>
        <div className="features-grid">
            <Feature
                icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12.75l9-9m0 0l-9 9m9-9v18m-9-9h18" /></svg>}
                title="Full-Stack Content Strategy"
            >
                Automatically identify core content pillars and generate entire "content clusters" to build topical authority and own your niche.
            </Feature>
            <Feature
                icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>}
                title="Data-Driven Content Engine"
            >
                 Leverage live SERP analysis to find competitor gaps and generate 10x content with automated schema markup for higher rankings.
            </Feature>
            <Feature
                icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0011.667 0l3.181-3.183m-4.991-2.696a8.25 8.25 0 010 11.667l-3.181 3.183a8.25 8.25 0 01-11.667 0l-3.181-3.183a8.25 8.25 0 010-11.667l3.181-3.183a8.25 8.25 0 0111.667 0l3.181 3.183" /></svg>}
                title="Automated Content Audits"
            >
                Automatically detect and flag "stale" content. Revitalize old posts with one click, turning content decay into a strategic advantage.
            </Feature>
        </div>
        <PromotionalLinks />
        <div className="risk-reversal">
            <p><strong>Your Advantage:</strong> This is a powerful, free tool designed to give you a competitive edge. There are no trials or fees. Simply configure your details below and start optimizing.</p>
        </div>
    </div>
);


const ConfigStep = ({ state, dispatch, onFetchSitemap, onValidateKey, onGscConnect, onGscDisconnect }) => {
    const { wpUrl, wpUser, wpPassword, sitemapUrl, urlLimit, loading, aiProvider, apiKeys, openRouterModels, keyStatus, gscClientId, gscAuthState, gscUser, gscSites, gscSelectedSite, gscDeviceInfo, gscConnectionError } = state;
    const isSitemapConfigValid = useMemo(() => sitemapUrl && sitemapUrl.trim() !== '', [sitemapUrl]);
    const isApiKeyValid = useMemo(() => apiKeys[aiProvider]?.trim() && keyStatus[aiProvider] !== 'invalid', [apiKeys, aiProvider, keyStatus]);
    const [saveConfig, setSaveConfig] = useState(true);
    const [isCopied, setIsCopied] = useState(false);
    const [isGscInstructionsVisible, setIsGscInstructionsVisible] = useState(false);
    
    const handleCopyCode = () => {
        if (gscDeviceInfo?.user_code) {
            navigator.clipboard.writeText(gscDeviceInfo.user_code).then(() => {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            }, (err) => {
                console.error('Could not copy text: ', err);
            });
        }
    };

    const debouncedValidateKey = useCallback(debounce(onValidateKey, 500), [onValidateKey]);

    const handleApiKeyChange = (e) => {
        const { value } = e.target;
        dispatch({ type: 'SET_API_KEY', payload: { provider: aiProvider, key: value } });
        if (value.trim() !== '') debouncedValidateKey(aiProvider, value);
    };

    const handleSerpApiKeyChange = (e) => {
        const { value } = e.target;
        dispatch({ type: 'SET_API_KEY', payload: { provider: 'serp', key: value } });
        if (value.trim() !== '') debouncedValidateKey('serp', value);
    };

    const handleProviderChange = (e) => {
        const newProvider = e.target.value;
        dispatch({ type: 'SET_AI_PROVIDER', payload: newProvider });
        const key = apiKeys[newProvider];
        if (key?.trim() && keyStatus[newProvider] === 'unknown') onValidateKey(newProvider, key);
    };

    const handleAnalyze = () => {
        const normalizedUrl = normalizeWpUrl(wpUrl);
        dispatch({ type: 'SET_FIELD', payload: { field: 'wpUrl', value: normalizedUrl } });
        onFetchSitemap(sitemapUrl, saveConfig, normalizedUrl);
    };

    return (
        <div className="step-container">
            <LandingPageIntro />
            <div className="config-forms-wrapper">
                <fieldset className="config-fieldset">
                    <legend>Content Source & Publishing</legend>
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem 2rem' }}>
                        <div>
                           <div className="form-group"><label htmlFor="sitemapUrl">Sitemap URL</label><input type="url" id="sitemapUrl" value={sitemapUrl} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'sitemapUrl', value: e.target.value } })} placeholder="https://example.com/sitemap.xml" /></div>
                           <div className="form-group"><label htmlFor="wpUrl">WordPress URL</label><input type="url" id="wpUrl" value={wpUrl} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'wpUrl', value: e.target.value } })} placeholder="https://example.com" /></div>
                        </div>
                         <div>
                            <div className="form-group"><label htmlFor="wpUser">WordPress Username</label><input type="text" id="wpUser" value={wpUser} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'wpUser', value: e.target.value } })} placeholder="admin" /></div>
                            <div className="form-group"><label htmlFor="wpPassword">Application Password</label><input type="password" id="wpPassword" value={wpPassword} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'wpPassword', value: e.target.value } })} placeholder="••••••••••••••••" /><p className="help-text" style={{marginTop: '0.25rem'}}>This is not your main password. <a href="https://wordpress.org/documentation/article/application-passwords/" target="_blank" rel="noopener noreferrer">Learn how to create one</a>.</p></div>
                        </div>
                    </div>
                     <div className="checkbox-group"><input type="checkbox" id="saveConfig" checked={saveConfig} onChange={(e) => setSaveConfig(e.target.checked)} /><label htmlFor="saveConfig">Save WordPress & GSC Configuration</label></div>
                </fieldset>
                
                <fieldset className="config-fieldset">
                    <legend>Intelligence & Analysis APIs</legend>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem 2rem' }}>
                        <div>
                             <h4 style={{marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-color)'}}>AI Content Generation</h4>
                            <div className="form-group"><label htmlFor="aiProvider">AI Provider</label><select id="aiProvider" value={aiProvider} onChange={handleProviderChange}><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter (Experimental)</option></select></div>
                            {aiProvider === 'openrouter' && (<div className="form-group"><label htmlFor="openRouterModel">Model</label><input type="text" id="openRouterModel" list="openrouter-models-list" value={state.openRouterModel} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'openRouterModel', value: e.target.value } })} placeholder="e.g., google/gemini-flash-1.5" /><datalist id="openrouter-models-list">{openRouterModels.map(model => <option key={model} value={model} />)}</datalist><p className="help-text">Enter any model name from <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">OpenRouter</a>.</p></div>)}
                            <div className="form-group api-key-group"><label htmlFor="apiKey">API Key</label><input type="password" id="apiKey" value={apiKeys[aiProvider] || ''} onChange={handleApiKeyChange} placeholder={`Enter your ${aiProvider.charAt(0).toUpperCase() + aiProvider.slice(1)} API Key`} /><ApiKeyValidator status={keyStatus[aiProvider]} /></div>
                        </div>
                         <div>
                            <h4 style={{marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-color)'}}>Live SERP Analysis</h4>
                             <div className="form-group api-key-group">
                                <label htmlFor="serpApiKey">SERP API Key (Optional)</label>
                                <input type="password" id="serpApiKey" value={apiKeys.serp || ''} onChange={handleSerpApiKeyChange} placeholder="Recommended: Serper.dev API Key" />
                                <ApiKeyValidator status={keyStatus.serp} />
                            </div>
                            <p className="help-text">
                                Enables real-time competitive analysis for new articles.
                                <a href="https://serper.dev" target="_blank" rel="noopener noreferrer"> Get a free key from Serper.dev</a>.
                            </p>
                        </div>
                    </div>
                </fieldset>

                <fieldset className="config-fieldset" style={{gridColumn: '1 / -1'}}>
                    <legend>Google Search Console</legend>
                    {gscAuthState !== 'connected' ? (
                        <div className="gsc-setup-container">
                             {gscAuthState === 'idle' && (
                                <div className="gsc-instructions">
                                    <p>Connect to Google Search Console to unlock powerful SEO insights, identify content decay, and find new keyword opportunities directly from your performance data.</p>
                                    
                                    <button 
                                        className={`gsc-toggle-btn ${isGscInstructionsVisible ? 'toggled' : ''}`} 
                                        onClick={() => setIsGscInstructionsVisible(!isGscInstructionsVisible)}
                                        aria-expanded={isGscInstructionsVisible}
                                    >
                                        {isGscInstructionsVisible ? 'Hide' : 'Show'} Setup Instructions
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                        </svg>
                                    </button>
                                    
                                    <div className={`gsc-instructions-collapsible ${isGscInstructionsVisible ? 'visible' : ''}`}>
                                        <div className="setup-step">
                                            <h5>Step 1: Enable the Search Console API</h5>
                                            <ol className="help-text">
                                                <li><a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener noreferrer">Open the Google Search Console API page</a>.</li>
                                                <li>Ensure you have the correct project selected at the top of the page.</li>
                                                <li>Click the blue <strong>"Enable"</strong> button. If it says "Manage", the API is already enabled and you can proceed.</li>
                                            </ol>
                                        </div>

                                        <div className="setup-step">
                                            <h5>Step 2: Configure the OAuth Consent Screen</h5>
                                            <ol className="help-text">
                                                <li><a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer">Open the OAuth Consent Screen page</a>.</li>
                                                <li>
                                                    <strong>First-Time Setup:</strong> If you see options for "Internal" and "External" user types, you must create the consent screen first:
                                                    <ul style={{marginTop: '0.5rem'}}>
                                                        <li>Select <strong>External</strong> and click <strong>CREATE</strong>.</li>
                                                        <li>On the next page ("Edit app registration"), fill in the three required fields: <strong>App name</strong> (e.g., "AI Content Tool"), your <strong>User support email</strong>, and your email under <strong>Developer contact information</strong>.</li>
                                                        <li>Scroll to the bottom and click <strong>SAVE AND CONTINUE</strong>.</li>
                                                    </ul>
                                                </li>
                                                <li>
                                                    <strong>Editing an Existing App:</strong> If you see a summary of your app instead, click the <strong>EDIT APP</strong> button. Then, on the first screen that appears, scroll to the bottom and click <strong>SAVE AND CONTINUE</strong>.
                                                </li>
                                                <li>
                                                    You are now on the <strong>"Scopes"</strong> page. Click the <strong>"ADD OR REMOVE SCOPES"</strong> button.
                                                </li>
                                                <li>A panel will slide in from the right. In the filter box at the top, type or paste: <code>https://www.googleapis.com/auth/webmasters.readonly</code></li>
                                                <li>Check the box next to the "Google Search Console API" scope that appears.</li>
                                                <li>Click the blue <strong>"Update"</strong> button at the bottom of the panel.</li>
                                                <li>You will be back on the Scopes page. Scroll down and click <strong>SAVE AND CONTINUE</strong> again.</li>
                                                <li>
                                                    <strong>Crucial:</strong> You are now on the "Test users" screen. If your app's "Publishing status" is "Testing", you MUST add your own Google email address here or the connection will fail. Click "ADD USERS" and enter your email.
                                                </li>
                                                <li>Click <strong>SAVE AND CONTINUE</strong> one last time to return to the main dashboard.</li>
                                            </ol>
                                        </div>

                                        <div className="setup-step">
                                            <h5>Step 3: Create & Paste Your Client ID</h5>
                                            <ol className="help-text">
                                                <li>Now that the API and Scopes are configured, <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">open the Credentials page</a>.</li>
                                                <li>Click <strong>+ CREATE CREDENTIALS</strong> at the top, then select <strong>OAuth client ID</strong>.</li>
                                                <li>On the next page, set the <strong>Application type</strong> to <strong>TVs and Limited Input devices</strong>. This is the only type that will work.</li>
                                                <li>Give the credential a name (e.g., "AI Content App") and click <strong>Create</strong>.</li>
                                                <li>A box will appear with your new Client ID. Copy it and paste it below. (If you created a "Web application" Client ID before by mistake, please delete it and use this new one.)</li>
                                            </ol>
                                        </div>
                                    </div>
                                    
                                    <div className="form-group" style={{marginTop: '1.5rem'}}>
                                        <label htmlFor="gscClientId">GSC Client ID (TVs and Limited Input type)</label>
                                        <input type="text" id="gscClientId" value={gscClientId} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'gscClientId', value: e.target.value } })} placeholder="Paste your Client ID here" />
                                    </div>
                                    <button className="btn" onClick={onGscConnect} disabled={!gscClientId.trim() || loading} style={{width: '100%'}}>
                                        {loading ? 'Connecting...' : 'Connect with Google'}
                                    </button>
                                    {gscConnectionError && (
                                        <div className="result error" style={{ marginTop: '1rem', textAlign: 'center' }}>
                                            {gscConnectionError}
                                        </div>
                                    )}
                                </div>
                             )}

                            {gscAuthState === 'awaiting_activation' && gscDeviceInfo && (
                                <div className="gsc-awaiting-activation">
                                    <h4>Authorize this Application</h4>
                                    <p>Open the following page in your browser:</p>
                                    <a href={gscDeviceInfo.verification_url} target="_blank" rel="noopener noreferrer">{gscDeviceInfo.verification_url}</a>
                                    <p style={{marginTop: '1.5rem'}}>And enter the code below:</p>
                                    <div className="gsc-user-code-display">
                                        <code>{gscDeviceInfo.user_code}</code>
                                        <button onClick={handleCopyCode} className={`btn-copy ${isCopied ? 'copied' : ''}`} disabled={!gscDeviceInfo.user_code}>
                                            {isCopied ? 'Copied!' : 'Copy'}
                                        </button>
                                    </div>
                                    <div className="gsc-polling-status">
                                        <div className="spinner" style={{width: '20px', height: '20px'}}></div>
                                        <span>Waiting for you to authorize...</span>
                                    </div>
                                    <button className="btn btn-secondary btn-small" style={{marginTop: '1.5rem'}} onClick={() => dispatch({type: 'GSC_CANCEL_AUTH'})}>Cancel</button>
                                </div>
                            )}

                        </div>
                    ) : (
                        <div style={{textAlign: 'center'}}>
                            <p style={{color: 'var(--success-color)', fontWeight: 500}}>Connected as {gscUser?.email}</p>
                            <div className="form-group">
                                <label htmlFor="gscSite">Select GSC Property</label>
                                <select id="gscSite" value={gscSelectedSite} onChange={(e) => dispatch({ type: 'SET_FIELD', payload: { field: 'gscSelectedSite', value: e.target.value }})}>
                                    <option value="">-- Select a site --</option>
                                    {gscSites.map(site => <option key={site.siteUrl} value={site.siteUrl}>{site.siteUrl}</option>)}
                                </select>
                            </div>
                            <button className="btn btn-secondary" onClick={onGscDisconnect}>Disconnect</button>
                        </div>
                    )}
                </fieldset>
            </div>

            <button className="btn" onClick={handleAnalyze} disabled={loading || !isSitemapConfigValid || !isApiKeyValid}>{loading ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Analyze Site & Continue'}</button>
        </div>
    );
};

const SingleArticleGenerator = ({ onGenerate, isGenerating }) => {
    const [topic, setTopic] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (topic.trim() && !isGenerating) {
            onGenerate(topic);
        }
    };

    return (
        <div className="single-article-hub">
            <h2>Single Article Generator</h2>
            <p>Enter your target keyword or a full blog post title below. The AI will generate a comprehensive, 1800+ word article designed to rank #1, complete with SEO metadata and schema.</p>
            <form onSubmit={handleSubmit} style={{maxWidth: '600px', margin: '0 auto', textAlign: 'left'}}>
                <div className="form-group">
                    <label htmlFor="newTopic">Topic or Keyword</label>
                    <input
                        type="text"
                        id="newTopic"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="e.g., How to start affiliate marketing in 2025"
                        disabled={isGenerating}
                    />
                </div>
                <button type="submit" className="btn" disabled={!topic.trim() || isGenerating} style={{width: '100%'}}>
                    {isGenerating ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Generate Article'}
                </button>
            </form>
        </div>
    );
};


const ContentClusterStrategist = ({ onGenerate, onGeneratePillars, onGenerateClusters, dispatch, state }) => {
    const { isGeneratingPillars, pillarTopics, selectedPillar, isGeneratingClusters, clusterPlan, loading } = state;

    if (pillarTopics.length === 0) {
        return (
            <div className="strategist-hub">
                <h2>AI Content Strategist</h2>
                <p>Let our AI analyze your entire sitemap to identify core "Pillar Topics." This forms the foundation of a powerful, interconnected content strategy that builds topical authority and dominates search rankings.</p>
                <button className="btn" onClick={onGeneratePillars} disabled={isGeneratingPillars}>
                    {isGeneratingPillars ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Analyze Website & Identify Pillar Topics'}
                </button>
            </div>
        );
    }

    const hasClusterPlan = clusterPlan.existingAssets.length > 0 || clusterPlan.newOpportunities.length > 0;

    return (
        <div className="strategist-hub" style={{textAlign: 'left'}}>
            <h2 style={{textAlign: 'center'}}>Step 1: Select Your Pillar Topic</h2>
            <p style={{textAlign: 'center'}}>These are the core content pillars AI has identified for your site. Choose one to build out a "content cluster" of supporting articles.</p>
            <div className="pillar-grid" style={{marginTop: '2.5rem', textAlign: 'left'}}>
                {pillarTopics.map((pillar, index) => (
                    <div 
                        className={`pillar-card ${selectedPillar?.title === pillar.title ? 'selected' : ''}`} 
                        key={index} 
                        onClick={() => dispatch({ type: 'SET_SELECTED_PILLAR', payload: pillar })}
                    >
                        <h4>{pillar.title}</h4>
                        <p>{pillar.description}</p>
                    </div>
                ))}
            </div>

            {selectedPillar && (
                <div className="cluster-section">
                    <h2 style={{textAlign: 'center'}}>Step 2: Generate Your Topical Cluster Plan</h2>
                    <p style={{textAlign: 'center'}}>Analyze existing content and identify gaps to create a comprehensive cluster around <strong>{selectedPillar.title}</strong>. This prevents keyword cannibalization and ensures a cohesive strategy.</p>
                    <div style={{display: 'flex', justifyContent: 'center'}}>
                        <button className="btn" onClick={() => onGenerateClusters(selectedPillar.title)} disabled={isGeneratingClusters}>
                            {isGeneratingClusters ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Generate Cluster Plan'}
                        </button>
                    </div>
                    
                    {hasClusterPlan && (
                        <div className="cluster-plan">
                             <h3 style={{textAlign: 'center', marginTop: '2.5rem'}}>Step 3: Execute Your Content Plan</h3>
                             
                             {clusterPlan.existingAssets.length > 0 && (
                                <div className="plan-section">
                                    <h4 className="plan-section-title">Optimize Existing Content</h4>
                                    {clusterPlan.existingAssets.map((asset, index) => (
                                        <div className="cluster-item" key={`existing-${index}`}>
                                             <div className="cluster-item-content">
                                                <h5><span className="cluster-item-badge existing">Existing Asset</span>{slugToTitle(asset.url)}</h5>
                                                <p><strong>Suggestion:</strong> {asset.suggestion}</p>
                                            </div>
                                            <button className="btn btn-secondary btn-small" onClick={() => onGenerate({ url: asset.url, title: slugToTitle(asset.url) })} disabled={loading}>
                                                {loading ? 'Busy...' : 'Rewrite Article'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                             )}

                            {clusterPlan.newOpportunities.length > 0 && (
                                <div className="plan-section">
                                    <h4 className="plan-section-title">Fill Content Gaps</h4>
                                    {clusterPlan.newOpportunities.map((opportunity, index) => (
                                       <div className="cluster-item" key={`new-${index}`}>
                                            <div className="cluster-item-content">
                                                <h5><span className="cluster-item-badge new">New Opportunity</span>{opportunity.title}</h5>
                                                <p>{opportunity.description}</p>
                                            </div>
                                            <button className="btn btn-secondary btn-small" onClick={() => onGenerate(opportunity.title, false, selectedPillar.title)} disabled={loading}>
                                                {loading ? 'Busy...' : 'Write Article'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const GscInsights = ({ state, dispatch, onGenerate, onFetchGscData }) => {
    const { isFetchingGsc, gscOpportunities, loading, gscSelectedSite } = state;

    if (!gscSelectedSite) {
        return (
            <div className="gsc-insights-hub">
                <h2>Google Search Console Performance Audit</h2>
                <p>Please select a GSC property in the 'Config' step to analyze your site's performance and uncover content opportunities.</p>
            </div>
        );
    }
    
    const hasData = gscOpportunities.lowCtrPages.length > 0 || gscOpportunities.strikingDistanceKeywords.length > 0;

    return (
        <div className="gsc-insights-hub" style={{textAlign: 'left'}}>
            <div style={{textAlign: 'center'}}>
                 <h2>Google Search Console Performance Audit</h2>
                 <p>Uncover high-impact content opportunities directly from your GSC data. Prioritize what to create or update for maximum SEO impact.</p>
                 <button className="btn" onClick={onFetchGscData} disabled={isFetchingGsc}>
                    {isFetchingGsc ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Run GSC Analysis'}
                </button>
            </div>
            
            {hasData && (
                <div className="cluster-plan">
                     {gscOpportunities.lowCtrPages.length > 0 && (
                        <div className="plan-section">
                            <h4 className="plan-section-title">Content Refresh Opportunities (High Impressions, Low CTR)</h4>
                            {gscOpportunities.lowCtrPages.map((page, index) => (
                                <div className="gsc-opportunity-item" key={`low-ctr-${index}`}>
                                     <div className="gsc-opportunity-item-content">
                                        <h5>{slugToTitle(page.keys[0])}</h5>
                                        <div className="gsc-metrics">
                                            <div className="gsc-metric"><span className="gsc-metric-label">Impressions</span><span className="gsc-metric-value">{Math.round(page.impressions).toLocaleString()}</span></div>
                                            <div className="gsc-metric"><span className="gsc-metric-label">Clicks</span><span className="gsc-metric-value">{Math.round(page.clicks).toLocaleString()}</span></div>
                                            <div className="gsc-metric"><span className="gsc-metric-label">CTR</span><span className="gsc-metric-value">{(page.ctr * 100).toFixed(2)}%</span></div>
                                            <div className="gsc-metric"><span className="gsc-metric-label">Position</span><span className="gsc-metric-value">{page.position.toFixed(1)}</span></div>
                                        </div>
                                    </div>
                                    <button className="btn btn-secondary btn-small" onClick={() => onGenerate({ url: page.keys[0], title: slugToTitle(page.keys[0]) })} disabled={loading}>
                                        {loading ? 'Busy...' : 'Rewrite with AI'}
                                    </button>
                                </div>
                            ))}
                        </div>
                     )}

                    {gscOpportunities.strikingDistanceKeywords.length > 0 && (
                        <div className="plan-section">
                            <h4 className="plan-section-title">New Keyword Opportunities (Pages 2-3 Rankings)</h4>
                            {gscOpportunities.strikingDistanceKeywords.map((kw, index) => (
                               <div className="gsc-opportunity-item" key={`striking-${index}`}>
                                    <div className="gsc-opportunity-item-content">
                                        <h5>{kw.keys[0]}</h5>
                                        <div className="gsc-metrics">
                                            <div className="gsc-metric"><span className="gsc-metric-label">Impressions</span><span className="gsc-metric-value">{Math.round(kw.impressions).toLocaleString()}</span></div>
                                            <div className="gsc-metric"><span className="gsc-metric-label">Avg. Position</span><span className="gsc-metric-value">{kw.position.toFixed(1)}</span></div>
                                        </div>
                                    </div>
                                    <button className="btn btn-secondary btn-small" onClick={() => onGenerate(kw.keys[0])} disabled={loading}>
                                        {loading ? 'Busy...' : 'Write New Article'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const PillarSuggestionsDisplay = ({ suggestions, onGenerate, generationStatus, bulkGenerationProgress }) => (
    <div className="pillar-suggestions-container" style={{marginBottom: '2rem'}}>
        <h3 style={{textAlign: 'center', fontSize: '1.5rem', marginBottom: '0.5rem'}}>AI Pillar Post Recommendations</h3>
        <p style={{textAlign: 'center', color: 'var(--text-light-color)', maxWidth: '600px', margin: '0 auto 2rem'}}>
            Our AI has analyzed your content and recommends upgrading these posts into comprehensive pillar pages to build topical authority.
        </p>
        <div className="promo-links-grid">
            {suggestions.map(post => {
                const status = generationStatus[String(post.id)] || 'idle';
                const isGeneratingThisPost = status === 'generating';
                const isBulkGenerating = bulkGenerationProgress.visible;
                const isDisabled = isGeneratingThisPost || isBulkGenerating;
                const isDone = status === 'done';
                const isError = status === 'error';

                return (
                    <div className="promo-link-card" key={post.id} style={{display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
                        <div>
                            <h4>{post.title}</h4>
                            <p className="help-text" style={{color: 'var(--text-light-color)'}}><strong>AI Rationale:</strong> {post.reason}</p>
                        </div>
                        <div style={{marginTop: '1rem', textAlign: 'right'}}>
                             {isDone ? (
                                <p style={{color: 'var(--success-color)', fontWeight: 500}}>Generated!</p>
                            ) : isError ? (
                                <p style={{color: 'var(--error-color)', fontWeight: 500}}>Failed</p>
                            ) : (
                                <button 
                                    className="btn btn-pillar btn-small" 
                                    onClick={() => onGenerate(post, true)}
                                    disabled={isDisabled}
                                >
                                    {isGeneratingThisPost ? <div className="spinner" style={{width: '18px', height: '18px'}}></div> : 'Generate Pillar'}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

const ExistingContentTable = ({ state, dispatch, onGenerateContent, onGenerateAll, onGenerateAllPillarPosts, onFetchExistingPosts, onIdentifyPillarCandidates }) => {
    const { posts, loading, generationStatus, selectedPostIds, searchTerm, sortConfig, bulkGenerationProgress, filterStatus, isIdentifyingPillars, pillarSuggestions } = state;
    const now = useMemo(() => new Date().getTime(), []);
    
    const postsWithStale = useMemo(() => posts.map(p => ({
        ...p,
        isStale: p.modified ? (now - new Date(p.modified).getTime()) > 365 * 24 * 60 * 60 * 1000 : false,
        status: generationStatus[String(p.id)] || 'idle'
    })), [posts, now, generationStatus]);

    const filteredPosts = useMemo(() => {
        let intermediatePosts = postsWithStale;

        if (filterStatus !== 'all') {
             intermediatePosts = intermediatePosts.filter(post => {
                if (filterStatus === 'stale') return post.isStale;
                if (filterStatus === 'generated') return post.status === 'done';
                if (filterStatus === 'ready') return post.status === 'idle' && !post.isStale;
                return true;
             });
        }
        
        if (searchTerm) {
            return intermediatePosts.filter(post => 
                post.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        return intermediatePosts;
    }, [postsWithStale, searchTerm, filterStatus]);

    const sortedPosts = useMemo(() => {
        const sorted = [...filteredPosts];
        if (sortConfig.key) {
            sorted.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                
                if (aVal == null) return 1;
                if (bVal == null) return -1;

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sorted;
    }, [filteredPosts, sortConfig]);
    
    const handleSort = (key) => {
        const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
        dispatch({ type: 'SET_SORT_CONFIG', payload: { key, direction } });
    };
    
    const handleSelectAll = () => {
        const allVisibleIds = sortedPosts.map(p => p.id);
        dispatch({ type: 'SELECT_ALL_VISIBLE', payload: allVisibleIds });
    };
    
    const handleSelectStale = () => {
        const staleIds = sortedPosts.filter(p => p.isStale).map(p => p.id);
        dispatch({ type: 'SELECT_STALE', payload: staleIds });
    };

    const allVisibleSelected = sortedPosts.length > 0 && sortedPosts.every(p => selectedPostIds.has(p.id));
    const staleCount = useMemo(() => postsWithStale.filter(p => p.isStale).length, [postsWithStale]);
    
    const generatableCount = useMemo(() => {
        return [...selectedPostIds].filter(id => {
            const status = generationStatus[String(id)];
            return status !== 'done' && status !== 'generating';
        }).length;
    }, [selectedPostIds, generationStatus]);

    const isGenerateAllDisabled = bulkGenerationProgress.visible || generatableCount === 0;

    const SortableHeader = ({ sortKey, children }) => {
        const isCurrentSort = sortConfig.key === sortKey;
        return (
            <th 
                className="sortable" 
                onClick={() => handleSort(sortKey)}
                aria-sort={isCurrentSort ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
                {children}
                <span className={`sort-indicator ${isCurrentSort ? sortConfig.direction : ''}`}>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </span>
            </th>
        );
    };

    return (
         <div className="step-container full-width">
            <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', color: 'var(--text-heading-color)', fontWeight: 700 }}>Content Audit & Revitalization</h2>
                <p style={{ margin: '0 auto', color: 'var(--text-light-color)', lineHeight: 1.6, maxWidth: '700px' }}>
                    Audit your entire library. Identify stale posts that need a refresh, find high-potential candidates for pillar pages, and generate updated versions with one click.
                </p>
            </div>

            {posts.length === 0 && !loading ? (
                <div className="fetch-posts-prompt">
                    <p>Ready to supercharge your existing content?</p>
                    <button className="btn" onClick={onFetchExistingPosts} disabled={loading}>
                        {loading ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : 'Fetch All Posts for Audit'}
                    </button>
                </div>
            ) : (
                <>
                    {pillarSuggestions.length > 0 && (
                        <PillarSuggestionsDisplay 
                            suggestions={pillarSuggestions} 
                            onGenerate={onGenerateContent}
                            generationStatus={generationStatus}
                            bulkGenerationProgress={bulkGenerationProgress}
                        />
                    )}

                    <div className="table-toolbar">
                         <div className="toolbar-section">
                            <input
                               type="search"
                               className="table-search-input"
                               placeholder="Search posts by title..."
                               value={searchTerm}
                               onChange={e => dispatch({ type: 'SET_SEARCH_TERM', payload: e.target.value })}
                            />
                            <select className="filter-select" value={filterStatus} onChange={e => dispatch({type: 'SET_FILTER_STATUS', payload: e.target.value})}>
                                <option value="all">Filter: All</option>
                                <option value="stale">Filter: Stale</option>
                                <option value="generated">Filter: Generated</option>
                                <option value="ready">Filter: Ready</option>
                            </select>
                            <button className="btn btn-secondary btn-small" onClick={onIdentifyPillarCandidates} disabled={isIdentifyingPillars}>
                               {isIdentifyingPillars ? <div className="spinner" style={{width: '18px', height: '18px'}}></div> : 'AI: Find Pillar Candidates'}
                            </button>
                        </div>
                        <div className="toolbar-section">
                            {staleCount > 0 && <button className="btn btn-secondary btn-small" onClick={handleSelectStale}>Select {staleCount} Stale</button>}
                            <div className="selection-info">
                                <label className="custom-checkbox-all">
                                    <input type="checkbox" onChange={handleSelectAll} checked={allVisibleSelected} />
                                    <span className="checkmark"></span>
                                    {selectedPostIds.size > 0 ? `${selectedPostIds.size} Selected` : 'Select All'}
                                </label>
                                {selectedPostIds.size > 0 && <button className="btn-text" onClick={() => dispatch({ type: 'DESELECT_ALL' })}>Deselect</button>}
                            </div>
                            <button className="btn btn-small" onClick={() => onGenerateAll(false)} disabled={isGenerateAllDisabled}>
                                {bulkGenerationProgress.visible ? 'Busy...' : `Update (${generatableCount})`}
                            </button>
                             <button className="btn btn-pillar btn-small" onClick={() => onGenerateAll(true)} disabled={isGenerateAllDisabled}>
                                {bulkGenerationProgress.visible ? 'Generating...' : `Pillar (${generatableCount})`}
                            </button>
                        </div>
                    </div>
                    
                    {bulkGenerationProgress.visible && (
                        <div className="bulk-progress-bar">
                            <div 
                                className="bulk-progress-bar-fill" 
                                style={{ width: `${(bulkGenerationProgress.current / bulkGenerationProgress.total) * 100}%` }}
                            ></div>
                            <span className="bulk-progress-bar-text">
                                Generating {bulkGenerationProgress.current} of {bulkGenerationProgress.total} posts...
                            </span>
                        </div>
                    )}

                    {loading && posts.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '4rem 0'}}>
                            <div className="spinner" style={{width: '48px', height: '48px', margin: '0 auto'}}></div>
                        </div>
                    ) : (
                        <div className="table-wrapper">
                            <table className="content-table">
                                <thead>
                                    <tr>
                                        <th style={{width: '50px'}}>
                                             <label className="custom-checkbox-all" style={{paddingLeft: '4px'}}>
                                                <input type="checkbox" onChange={handleSelectAll} checked={allVisibleSelected} />
                                                <span className="checkmark"></span>
                                            </label>
                                        </th>
                                        <SortableHeader sortKey="title">Post Title</SortableHeader>
                                        <th>Status</th>
                                        <SortableHeader sortKey="modified">Last Modified</SortableHeader>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedPosts.map(post => {
                                        const isSelected = selectedPostIds.has(post.id);
                                        return (
                                            <tr key={post.id} className={`${isSelected ? 'selected' : ''}`}>
                                                <td>
                                                    <label className="custom-checkbox" style={{paddingLeft: '4px'}}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => dispatch({ type: 'TOGGLE_POST_SELECTION', payload: post.id })}
                                                        />
                                                        <span className="checkmark"></span>
                                                    </label>
                                                </td>
                                                <td className="post-title-cell">
                                                    <a href={post.url} target="_blank" rel="noopener noreferrer">{post.title}</a>
                                                    {post.isStale && <span className="stale-badge">Needs Refresh</span>}
                                                </td>
                                                <td>
                                                     <div className={`status status-${post.status}`}>
                                                        <span className="status-dot"></span>
                                                        {post.status === 'generating' ? 'Generating' : post.status === 'done' ? 'Generated' : post.status === 'error' ? 'Error' : 'Ready'}
                                                    </div>
                                                </td>
                                                <td>
                                                    {post.modified ? new Date(post.modified).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                                                </td>
                                                <td>
                                                    <div className="table-actions">
                                                        {post.status !== 'done' && post.status !== 'generating' && (
                                                            <>
                                                                <button className="btn btn-secondary btn-small" onClick={() => onGenerateContent(post, false)} disabled={bulkGenerationProgress.visible}>
                                                                    Update
                                                                </button>
                                                                <button className="btn btn-pillar btn-small" onClick={() => onGenerateContent(post, true)} disabled={bulkGenerationProgress.visible}>
                                                                    Pillar
                                                                </button>
                                                            </>
                                                        )}
                                                         {post.status === 'generating' && (
                                                            <div className="spinner" style={{width: '24px', height: '24px'}}></div>
                                                         )}
                                                        {post.status === 'done' && (
                                                            <button className="btn btn-small" onClick={() => dispatch({ type: 'OPEN_REVIEW_MODAL', payload: posts.findIndex(p => p.id === post.id) })}>
                                                                Review
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
         </div>
    );
};

const ContentStep = ({ state, dispatch, onGenerateContent, onFetchExistingPosts, onGenerateAll, onGenerateAllPillarPosts, onGeneratePillarTopics, onGenerateClusterTopics, onIdentifyPillarCandidates, onFetchGscData }) => {
    const { contentMode, gscAuthState } = state;
    const gscIsConnected = gscAuthState === 'connected';

    return (
        <div className="step-container">
            <div className="content-mode-toggle">
                {gscIsConnected && (
                    <button className={contentMode === 'gsc' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_CONTENT_MODE', payload: 'gsc' })}>
                        GSC Insights
                    </button>
                )}
                <button className={contentMode === 'cluster' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_CONTENT_MODE', payload: 'cluster' })}>
                    Content Cluster Strategist
                </button>
                 <button className={contentMode === 'single' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_CONTENT_MODE', payload: 'single' })}>
                    Single Article
                </button>
                <button className={contentMode === 'update' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_CONTENT_MODE', payload: 'update' })}>
                    Update Existing Content
                </button>
            </div>
            
            {contentMode === 'gsc' && gscIsConnected && (
                <GscInsights
                    state={state}
                    dispatch={dispatch}
                    onGenerate={onGenerateContent}
                    onFetchGscData={onFetchGscData}
                />
            )}

            {contentMode === 'cluster' && (
                <ContentClusterStrategist
                    state={state}
                    dispatch={dispatch}
                    onGenerate={onGenerateContent}
                    onGeneratePillars={onGeneratePillarTopics}
                    onGenerateClusters={onGenerateClusterTopics}
                />
            )}

            {contentMode === 'single' && (
                 <SingleArticleGenerator
                    onGenerate={onGenerateContent}
                    isGenerating={state.loading}
                 />
            )}

            {contentMode === 'update' && (
                <ExistingContentTable
                    state={state}
                    dispatch={dispatch}
                    onGenerateContent={onGenerateContent}
                    onGenerateAll={onGenerateAll}
                    onGenerateAllPillarPosts={onGenerateAllPillarPosts}
                    onFetchExistingPosts={onFetchExistingPosts}
                    onIdentifyPillarCandidates={onIdentifyPillarCandidates}
                />
            )}
        </div>
    );
};

const QualityScoreDisplay = ({ score }) => {
    const scoreRef = useRef(null);

    useEffect(() => {
        if (scoreRef.current && score) {
            // This forces the CSS transition to trigger by setting the property after a render cycle
            setTimeout(() => {
                scoreRef.current.style.setProperty('--score', score.overall);
                const metricBars = scoreRef.current.querySelectorAll('.metric-bar');
                metricBars.forEach(bar => {
                    const metricName = bar.dataset.metric;
                    if (metricName && score.metrics[metricName]) {
                        bar.style.width = `${score.metrics[metricName]}%`;
                    }
                });
            }, 100);
        }
    }, [score]);

    if (!score) {
        return (
            <div className="quality-score-placeholder">
                <p>Analyzing content quality...</p>
                <div className="spinner" style={{width: '32px', height: '32px', borderWidth: '3px', margin: '1rem auto 0'}}></div>
            </div>
        );
    }

    return (
        <div className="quality-score-tab-content" ref={scoreRef}>
            <div className="score-overview">
                <div className="score-circle" style={{'--score': 0} as React.CSSProperties}>
                    <span className="score-circle-number">{score.overall}</span>
                    <span className="score-circle-label">Overall</span>
                </div>
                <div className="score-details">
                    <div className="score-metric">
                        <div className="metric-label-container"><span className="metric-label">Readability</span><span className="metric-value">{score.metrics.readability}/100</span></div>
                        <div className="metric-bar-container"><div className="metric-bar" data-metric="readability"></div></div>
                    </div>
                     <div className="score-metric">
                        <div className="metric-label-container"><span className="metric-label">SEO</span><span className="metric-value">{score.metrics.seo}/100</span></div>
                        <div className="metric-bar-container"><div className="metric-bar" data-metric="seo"></div></div>
                    </div>
                     <div className="score-metric">
                        <div className="metric-label-container"><span className="metric-label">E-E-A-T</span><span className="metric-value">{score.metrics.eeat}/100</span></div>
                        <div className="metric-bar-container"><div className="metric-bar" data-metric="eeat"></div></div>
                    </div>
                     <div className="score-metric">
                        <div className="metric-label-container"><span className="metric-label">Engagement</span><span className="metric-value">{score.metrics.engagement}/100</span></div>
                        <div className="metric-bar-container"><div className="metric-bar" data-metric="engagement"></div></div>
                    </div>
                </div>
            </div>
            <div className="feedback-section">
                <div className="feedback-card strength-card">
                    <h4><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>Key Strength</h4>
                    <p>{score.strength}</p>
                </div>
                <div className="feedback-card improvement-card">
                     <h4><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>Top Improvement Area</h4>
                    <p>{score.improvement}</p>
                </div>
            </div>
        </div>
    );
};

const ReviewModal = ({ state, dispatch, onPublish, onClose }) => {
    const { posts, loading, publishingStatus, currentReviewIndex } = state;
    const currentPost = posts[currentReviewIndex];
    const [activeTab, setActiveTab] = useState('qualityScore');
    
    useEffect(() => {
        // Reset to quality score tab when the post being reviewed changes
        setActiveTab('qualityScore');
    }, [currentReviewIndex]);
    
    if (!currentPost) return null;
    
    const updatePostField = (field, value) => {
        dispatch({ type: 'UPDATE_POST_FIELD', payload: { index: currentReviewIndex, field, value } });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">&times;</button>
                
                 {posts.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <button className="btn btn-small" onClick={() => dispatch({type: 'SET_REVIEW_INDEX', payload: Math.max(0, currentReviewIndex - 1)})} disabled={currentReviewIndex === 0}>Previous</button>
                        <span>Viewing {currentReviewIndex + 1} of {posts.length}</span>
                        <button className="btn btn-small" onClick={() => dispatch({type: 'SET_REVIEW_INDEX', payload: Math.min(posts.length - 1, currentReviewIndex + 1)})} disabled={currentReviewIndex === posts.length - 1}>Next</button>
                    </div>
                )}
                
                <div className="review-tabs">
                    <button className={`tab-btn ${activeTab === 'qualityScore' ? 'active' : ''}`} onClick={() => setActiveTab('qualityScore')}>Quality Score</button>
                    <button className={`tab-btn ${activeTab === 'editor' ? 'active' : ''}`} onClick={() => setActiveTab('editor')}>Editor</button>
                    <button className={`tab-btn ${activeTab === 'seo' ? 'active' : ''}`} onClick={() => setActiveTab('seo')}>SEO</button>
                    <button className={`tab-btn ${activeTab === 'schema' ? 'active' : ''}`} onClick={() => setActiveTab('schema')}>Schema</button>
                    <button className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => setActiveTab('preview')}>Live Preview</button>
                </div>

                <div className="tab-content">
                    {activeTab === 'qualityScore' && <QualityScoreDisplay score={currentPost.qualityScore} />}
                    {activeTab === 'editor' && (
                        <>
                            <div className="form-group"><label htmlFor="postTitle">Post Title (H1)</label><input type="text" id="postTitle" value={currentPost.title || ''} onChange={e => updatePostField('title', e.target.value)} /></div>
                            <div className="form-group"><label htmlFor="content">HTML Content</label><textarea id="content" value={currentPost.content || ''} onChange={e => updatePostField('content', e.target.value)}></textarea></div>
                        </>
                    )}
                    {activeTab === 'seo' && (
                        <>
                            <div className="form-group"><div className="label-wrapper"><label htmlFor="metaTitle">Meta Title</label><span className="char-counter">{String(currentPost.metaTitle || '').length} / 60</span></div><input type="text" id="metaTitle" value={currentPost.metaTitle || ''} onChange={e => updatePostField('metaTitle', e.target.value)} /></div>
                            <div className="form-group"><div className="label-wrapper"><label htmlFor="metaDescription">Meta Description</label><span className="char-counter">{String(currentPost.metaDescription || '').length} / 160</span></div><textarea id="metaDescription" className="meta-description-input" value={currentPost.metaDescription || ''} onChange={e => updatePostField('metaDescription', e.target.value)} /></div>
                        </>
                    )}
                    {activeTab === 'schema' && (
                        <div className="form-group">
                            <label htmlFor="schemaMarkup">JSON-LD Schema Markup</label>
                            <textarea id="schemaMarkup" value={currentPost.schemaMarkup || ''} onChange={e => updatePostField('schemaMarkup', e.target.value)}></textarea>
                            <p className="help-text">The AI generates this automatically. It will be wrapped in `&lt;script&gt;` tags and added to the top of your post.</p>
                        </div>
                    )}
                    {activeTab === 'preview' && (
                        <div className="live-preview">
                            <h1>{currentPost.title}</h1>
                            <div dangerouslySetInnerHTML={{ __html: currentPost.content }} />
                        </div>
                    )}
                </div>

                <div className="button-group">
                    <button className="btn btn-secondary" onClick={onClose}>Back to List</button>
                    <button className="btn" onClick={() => onPublish(currentPost)} disabled={loading}>{loading ? <div className="spinner" style={{width: '24px', height: '24px', borderWidth: '2px'}}></div> : `Publish to WordPress`}</button>
                </div>
                 {publishingStatus[String(currentPost.id)] && (
                    <div className={`result ${publishingStatus[String(currentPost.id)].success ? 'success' : 'error'}`}>
                        {publishingStatus[String(currentPost.id)].message}
                        {publishingStatus[String(currentPost.id)].link && <>&nbsp;<a href={publishingStatus[String(currentPost.id)].link} target="_blank" rel="noopener noreferrer">View Post</a></>}
                    </div>
                )}
            </div>
        </div>
    );
};

const Footer = () => (
    <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} <a href="https://affiliatemarketingforsuccess.com" target="_blank" rel="noopener noreferrer">Affiliate Marketing For Success</a>. All Rights Reserved.</p>
        <p>Powered by the AI Content Engine</p>
    </footer>
);

const FileProtocolBlocker = () => (
    <div className="file-protocol-blocker">
        <div className="file-protocol-modal">
            <h2>Action Required: Please Start a Web Server</h2>
            <p>This application cannot connect to Google's services when opened directly from your computer as a file.</p>
            <p><strong>To fix this, please follow these two simple steps:</strong></p>
            <ol>
                <li>Open your Terminal (Mac/Linux) or Command Prompt (Windows) in the same folder as the <code>index.html</code> file.</li>
                <li>Type the command below and press Enter:</li>
            </ol>
            <code>npx serve</code>
            <p>Your terminal will then give you a local web address. Please open that address (usually <code>http://localhost:3000</code>) in your browser to use the app correctly.</p>
        </div>
    </div>
);

const initialState = {
    currentStep: 1,
    wpUrl: '', wpUser: '', wpPassword: '', sitemapUrl: '',
    posts: [],
    sitemapUrls: [] as string[],
    loading: false, error: null,
    aiProvider: 'gemini',
    apiKeys: { gemini: '', openai: '', anthropic: '', openrouter: '', serp: '' },
    keyStatus: { gemini: 'unknown', openai: 'unknown', anthropic: 'unknown', openrouter: 'unknown', serp: 'unknown' },
    openRouterModel: 'google/gemini-flash-1.5',
    openRouterModels: ['google/gemini-flash-1.5', 'openai/gpt-4o', 'anthropic/claude-3-haiku'],
    contentMode: 'cluster',
    publishingStatus: {} as { [key: string]: { success: boolean, message: string, link?: string } },
    generationStatus: {} as { [key: string]: 'idle' | 'generating' | 'done' | 'error' },
    bulkGenerationProgress: { current: 0, total: 0, visible: false },
    currentReviewIndex: 0,
    isReviewModalOpen: false,
    selectedPostIds: new Set(),
    searchTerm: '',
    sortConfig: { key: 'modified', direction: 'asc' },
    filterStatus: 'all',
    isGeneratingPillars: false,
    pillarTopics: [] as { title: string; description: string }[],
    selectedPillar: null as { title: string; description: string } | null,
    isGeneratingClusters: false,
    clusterPlan: { existingAssets: [], newOpportunities: [] } as { existingAssets: { url: string; suggestion: string }[], newOpportunities: { title: string; description: string }[] },
    isIdentifyingPillars: false,
    pillarSuggestions: [] as { id: number; title: string; url: string; reason: string }[],
    gscClientId: '',
    gscAuthState: 'idle' as 'idle' | 'awaiting_activation' | 'connected',
    gscDeviceInfo: null,
    gscToken: null,
    gscUser: null,
    gscSites: [],
    gscSelectedSite: '',
    isFetchingGsc: false,
    gscOpportunities: { lowCtrPages: [], strikingDistanceKeywords: [] },
    gscConnectionError: null,
};

function reducer(state, action) {
    switch (action.type) {
        case 'SET_STEP': return { ...state, currentStep: action.payload };
        case 'SET_FIELD': return { ...state, [action.payload.field]: action.payload.value };
        case 'SET_API_KEY': return { ...state, apiKeys: { ...state.apiKeys, [action.payload.provider]: action.payload.key }, keyStatus: { ...state.keyStatus, [action.payload.provider]: 'validating' } };
        case 'SET_AI_PROVIDER': return { ...state, aiProvider: action.payload };
        case 'SET_KEY_STATUS': return { ...state, keyStatus: { ...state.keyStatus, [action.payload.provider]: action.payload.status } };
        case 'FETCH_START': return { ...state, loading: true, error: null };
        case 'FETCH_SITEMAP_SUCCESS': return { ...state, loading: false, posts: [], sitemapUrls: action.payload.sitemapUrls, currentStep: 2, contentMode: state.gscAuthState === 'connected' ? 'gsc' : 'cluster', generationStatus: {}, selectedPostIds: new Set(), pillarTopics: [], selectedPillar: null, clusterPlan: { existingAssets: [], newOpportunities: [] } };
        case 'FETCH_EXISTING_POSTS_SUCCESS': return { ...state, loading: false, posts: action.payload.map(p => ({...p, qualityScore: null})), generationStatus: {}, selectedPostIds: new Set(), searchTerm: '', sortConfig: { key: 'modified', direction: 'asc' }, filterStatus: 'all', pillarSuggestions: [] };
        case 'FETCH_ERROR': return { ...state, loading: false, error: action.payload };
        case 'SET_GENERATION_STATUS': return { ...state, generationStatus: { ...state.generationStatus, [String(action.payload.postId)]: action.payload.status } };
        case 'GENERATE_SINGLE_POST_SUCCESS': return { ...state, posts: state.posts.map(p => String(p.id) === String(action.payload.id) ? {...action.payload, qualityScore: p.qualityScore || null} : p) };
        case 'ADD_GENERATED_POST_AND_REVIEW': {
            const newPosts = [...state.posts, { ...action.payload, qualityScore: null }];
            return {
                ...state,
                posts: newPosts,
                loading: false,
                isReviewModalOpen: true,
                currentReviewIndex: newPosts.length - 1,
            };
        }
        case 'ADD_QUALITY_SCORE': return { ...state, posts: state.posts.map(post => String(post.id) === String(action.payload.postId) ? { ...post, qualityScore: action.payload.scoreData } : post ) };
        case 'UPDATE_POST_FIELD': return { ...state, posts: state.posts.map((post, index) => index === action.payload.index ? { ...post, [action.payload.field]: action.payload.value } : post) };
        case 'SET_CONTENT_MODE': return { ...state, contentMode: action.payload, posts: [], error: null, generationStatus: {}, selectedPostIds: new Set(), searchTerm: '', pillarTopics: [], selectedPillar: null, clusterPlan: { existingAssets: [], newOpportunities: [] }, pillarSuggestions: [] };
        case 'PUBLISH_START': return { ...state, loading: true };
        case 'PUBLISH_SUCCESS': {
            const { originalPostId, responseData, message, link } = action.payload;
            const newPostId = Number(responseData.id);
            const isCreation = typeof originalPostId === 'number' && originalPostId < 0;
            const newPublishingStatus = { ...state.publishingStatus };
            if (isCreation) delete newPublishingStatus[String(originalPostId)];
            newPublishingStatus[String(newPostId)] = { success: true, message, link };
            const updatedPosts = state.posts.map(post => {
                if (String(post.id) === String(originalPostId)) {
                    return { ...post, id: newPostId, url: responseData.link, modified: responseData.modified };
                }
                return post;
            });
            return { ...state, loading: false, posts: updatedPosts, publishingStatus: newPublishingStatus };
        }
        case 'PUBLISH_ERROR': {
            const { postId, message } = action.payload;
            const newPublishingStatus = { ...state.publishingStatus };
            newPublishingStatus[String(postId)] = { success: false, message };
            return { ...state, loading: false, publishingStatus: newPublishingStatus };
        }
        case 'LOAD_CONFIG': return { ...state, ...action.payload };
        case 'SET_REVIEW_INDEX': return { ...state, currentReviewIndex: action.payload };
        case 'OPEN_REVIEW_MODAL': return { ...state, isReviewModalOpen: true, currentReviewIndex: action.payload };
        case 'CLOSE_REVIEW_MODAL': return { ...state, isReviewModalOpen: false };
        case 'TOGGLE_POST_SELECTION': {
            const newSelection = new Set(state.selectedPostIds);
            if (newSelection.has(action.payload)) newSelection.delete(action.payload);
            else newSelection.add(action.payload);
            return { ...state, selectedPostIds: newSelection };
        }
        case 'SELECT_ALL_VISIBLE': {
            const newSelection = new Set(state.selectedPostIds);
            const allVisibleIds = action.payload;
            const allCurrentlySelected = allVisibleIds.length > 0 && allVisibleIds.every(id => newSelection.has(id));
            if (allCurrentlySelected) allVisibleIds.forEach(id => newSelection.delete(id));
            else allVisibleIds.forEach(id => newSelection.add(id));
            return { ...state, selectedPostIds: newSelection };
        }
        case 'SELECT_STALE': {
            const newSelection = new Set(state.selectedPostIds);
            action.payload.forEach(id => newSelection.add(id));
            return { ...state, selectedPostIds: newSelection };
        }
        case 'DESELECT_ALL': return { ...state, selectedPostIds: new Set() };
        case 'SET_SEARCH_TERM': return { ...state, searchTerm: action.payload };
        case 'SET_FILTER_STATUS': return { ...state, filterStatus: action.payload };
        case 'SET_SORT_CONFIG': return { ...state, sortConfig: action.payload };
        case 'BULK_GENERATE_START': return { ...state, bulkGenerationProgress: { current: 0, total: action.payload, visible: true } };
        case 'BULK_GENERATE_PROGRESS': return { ...state, bulkGenerationProgress: { ...state.bulkGenerationProgress, current: state.bulkGenerationProgress.current + 1 } };
        case 'BULK_GENERATE_COMPLETE': return { ...state, bulkGenerationProgress: { current: 0, total: 0, visible: false } };
        case 'GENERATE_PILLARS_START': return { ...state, isGeneratingPillars: true, error: null, pillarTopics: [] };
        case 'GENERATE_PILLARS_SUCCESS': return { ...state, isGeneratingPillars: false, pillarTopics: action.payload };
        case 'GENERATE_PILLARS_ERROR': return { ...state, isGeneratingPillars: false, error: action.payload };
        case 'SET_SELECTED_PILLAR': return { ...state, selectedPillar: action.payload, clusterPlan: { existingAssets: [], newOpportunities: [] } };
        case 'GENERATE_CLUSTERS_START': return { ...state, isGeneratingClusters: true, error: null, clusterPlan: { existingAssets: [], newOpportunities: [] } };
        case 'GENERATE_CLUSTERS_SUCCESS': return { ...state, isGeneratingClusters: false, clusterPlan: action.payload };
        case 'GENERATE_CLUSTERS_ERROR': return { ...state, isGeneratingClusters: false, error: action.payload };
        case 'IDENTIFY_PILLARS_START': return { ...state, isIdentifyingPillars: true, error: null, pillarSuggestions: [] };
        case 'IDENTIFY_PILLARS_SUCCESS': return { ...state, isIdentifyingPillars: false, pillarSuggestions: action.payload };
        case 'IDENTIFY_PILLARS_ERROR': return { ...state, isIdentifyingPillars: false, error: action.payload };
        // GSC Reducers
        case 'GSC_AUTH_START': return { ...state, loading: true, error: null, gscConnectionError: null };
        case 'GSC_AWAITING_ACTIVATION': return { ...state, loading: false, gscAuthState: 'awaiting_activation', gscDeviceInfo: action.payload };
        case 'GSC_CONNECT_SUCCESS': return { ...state, loading: false, gscAuthState: 'connected', gscToken: action.payload.token, gscUser: action.payload.user, gscDeviceInfo: null, error: null, gscConnectionError: null };
        case 'GSC_AUTH_ERROR': return { ...state, loading: false, gscAuthState: 'idle', gscDeviceInfo: null, gscConnectionError: action.payload };
        case 'GSC_CANCEL_AUTH': return { ...state, loading: false, gscAuthState: 'idle', gscDeviceInfo: null, error: null, gscConnectionError: null };
        case 'GSC_SET_SITES': return { ...state, gscSites: action.payload, gscSelectedSite: action.payload[0]?.siteUrl || '' };
        case 'GSC_DISCONNECT': return { ...state, gscAuthState: 'idle', gscToken: null, gscUser: null, gscSites: [], gscSelectedSite: '', gscOpportunities: { lowCtrPages: [], strikingDistanceKeywords: [] } };
        case 'GSC_FETCH_START': return { ...state, isFetchingGsc: true, error: null };
        case 'GSC_FETCH_SUCCESS': return { ...state, isFetchingGsc: false, gscOpportunities: action.payload };
        case 'GSC_FETCH_ERROR': return { ...state, isFetchingGsc: false, error: action.payload };

        default: throw new Error(`Unhandled action type: ${action.type}`);
    }
}

const PROMOTIONAL_LINKS = [
    'https://affiliatemarketingforsuccess.com/blog/','https://affiliatemarketingforsuccess.com/seo/write-meta-descriptions-that-convert/','https://affiliatemarketingforsuccess.com/blogging/winning-content-strategy/','https://affiliatemarketingforsuccess.com/review/copy-ai-review/','https://affiliatemarketingforsuccess.com/how-to-start/how-to-choose-a-web-host/','https://affiliatemarketingforsuccess.com/ai/detect-ai-writing/','https://affiliatemarketingforsuccess.com/affiliate-marketing/warriorplus-affiliate-program-unlock-lucrative-opportunities/','https://affiliatemarketingforsuccess.com/affiliate-marketing/understanding-what-is-pay-per-call-affiliate-marketing/','https://affiliatemarketingforsuccess.com/ai/how-chatbot-can-make-you-money/','https://affiliatemarketingforsuccess.com/info/influencer-marketing-sales/','https://affiliatemarketingforsuccess.com/ai/the-power-of-large-language-models/','https://affiliatemarketingforsuccess.com/how-to-start/10-simple-steps-to-build-your-website-a-beginners-guide/','https://affiliatemarketingforsuccess.com/blogging/sustainable-content/','https://affiliatemarketingforsuccess.com/affiliate-marketing/best-discounts-on-black-friday/','https://affiliatemarketingforsuccess.com/seo/website-architecture-that-drives-conversions/','https://affiliatemarketingforsuccess.com/blogging/how-to-create-evergreen-content/','https://affiliatemarketingforsuccess.com/email-marketing/email-marketing-benefits/','https://affiliatemarketingforsuccess.com/blogging/promote-your-blog-to-increase-traffic/','https://affiliatemarketingforsuccess.com/ai/discover-the-power-of-chatgpt/','https://affiliatemarketingforsuccess.com/affiliate-marketing/affiliate-marketing-with-personalized-recommendations/','https://affiliatemarketingforsuccess.com/seo/benefits-of-an-effective-seo-strategy/','https://affiliatemarketingforsuccess.com/ai/what-is-ai-prompt-engineering/','https://affiliatemarketingforsuccess.com/affiliate-marketing/successful-in-affiliate-marketing/','https://affiliatemarketingforsuccess.com/affiliate-marketing/join-the-best-affiliate-networks/','https://affiliatemarketingforsuccess.com/affiliate-marketing/beginners-guide-to-affiliate-marketing/','https://affiliatemarketingforsuccess.com/affiliate-marketing/high-ticket-affiliate-marketing/','https://affiliatemarketingforsuccess.com/affiliate-marketing/enhance-your-affiliate-marketing-content/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-do-affiliate-marketing-on-shopify/','https://affiliatemarketingforsuccess.com/affiliate-marketing/discover-why-affiliate-marketing-is-the-best-business-model/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-affiliate-marketing-helps-you-to-become-an-influencer/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-affiliate-marketing-on-blog/','https://affiliatemarketingforsuccess.com/affiliate-marketing/affiliate-networks/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-create-a-landing-page-for-affiliate-marketing/','https://affiliatemarketingforsuccess.com/review/scalenut-review/','https://affiliatemarketingforsuccess.com/seo/how-to-improve-your-content-marketing-strategy-in-2025/','https://affiliatemarketingforsuccess.com/ai/startup-success-with-chatgpt/','https://affiliatemarketingforsuccess.com/blogging/market-your-blog-the-right-way/','https://affiliatemarketingforsuccess.com/ai/surfer-seo-alternatives/','https://affiliatemarketingforsuccess.com/ai/avoid-ai-detection/','https://affiliatemarketingforsuccess.com/seo/optimize-your-off-page-seo-strategy/','https://affiliatemarketingforsuccess.com/ai/chatgpt-alternative/','https://affiliatemarketingforsuccess.com/seo/build-an-effective-seo-strategy/','https://affiliatemarketingforsuccess.com/email-marketing/understanding-email-marketing/','https://affiliatemarketingforsuccess.com/ai/write-handwritten-assignments/','https://affiliatemarketingforsuccess.com/ai/prompt-engineering-secrets/','https://affiliatemarketingforsuccess.com/seo/boost-your-organic-ranking/','https://affiliatemarketingforsuccess.com/seo/how-to-use-google-my-business-to-improve-your-blogs-local-seo/','https://affiliatemarketingforsuccess.com/affiliate-marketing/affiliate-marketing-tips-for-beginners/','https://affiliatemarketingforsuccess.com/ai/chatgpt-occupation-prompts/','https://affiliatemarketingforsuccess.com/ai/perplexity-copilot/','https://affiliatemarketingforsuccess.com/ai/agility-writer-vs-autoblogging-ai/','https://affiliatemarketingforsuccess.com/ai/split-testing-perplexity-pages-affiliate-sales/','https://affiliatemarketingforsuccess.com/ai/perplexity-ai-affiliate-funnels-automation/','https://affiliatemarketingforsuccess.com/ai/ai-content-detectors-reliability/','https://affiliatemarketingforsuccess.com/ai/google-bard-bypass-detection/','https://affiliatemarketingforsuccess.com/ai/teachers-detect-gpt-4/','https://affiliatemarketingforsuccess.com/ai/how-to-write-with-perplexity-ai/','https://affiliatemarketingforsuccess.com/ai/turnitin-ai-detection-accuracy/','https://affiliatemarketingforsuccess.com/ai/undetectable-ai-alternatives/','https://affiliatemarketingforsuccess.com/ai/perplexity-jailbreak-prompts-2/','https://affiliatemarketingforsuccess.com/affiliate-marketing/earn-generous-commissions-with-walmart-affiliate-program/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-increase-your-affiliate-marketing-conversion-rate/','https://affiliatemarketingforsuccess.com/ai/how-chat-gpt-will-change-education/','https://affiliatemarketingforsuccess.com/email-marketing/getresponse-review-2025/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-create-an-affiliate-marketing-strategy/','https://affiliatemarketingforsuccess.com/ai/perplexity-model/','https://affiliatemarketingforsuccess.com/email-marketing/proven-ways-to-grow-your-email-list/','https://affiliatemarketingforsuccess.com/ai/undetectable-ai/','https://affiliatemarketingforsuccess.com/review/use-fiverr-gigs-to-boost-your-business/','https://affiliatemarketingforsuccess.com/seo/google-ranking-factors/','https://affiliatemarketingforsuccess.com/ai/how-chat-gpt-is-different-from-google/','https://affiliatemarketingforsuccess.com/blogging/a-guide-to-copyediting-vs-copywriting/','https://affiliatemarketingforsuccess.com/email-marketing/craft-irresistible-email-newsletters/','https://affiliatemarketingforsuccess.com/affiliate-marketing/affiliate-marketing-on-instagram/','https://affiliatemarketingforsuccess.com/ai/integrate-perplexity-ai-affiliate-tech-stack/','https://affiliatemarketingforsuccess.com/ai/affiliate-marketing-perplexity-ai-future/','https://affiliatemarketingforsuccess.com/blogging/increase-domain-authority-quickly/','https://affiliatemarketingforsuccess.com/review/wp-rocket-boost-wordpress-performance/','https://affiliatemarketingforsuccess.com/affiliate-marketing/shein-affiliate-program-usa-fashionable-earnings-await-you/','https://affiliatemarketingforsuccess.com/affiliate-marketing/how-to-increase-affiliate-marketing-conversion-rates/'];

const App = () => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const [isFileProtocol, setIsFileProtocol] = useState(false);
    const gscPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


    useEffect(() => {
        // This check is crucial for the GSC OAuth flow.
        if (window.location.protocol === 'file:') {
            setIsFileProtocol(true);
        }
    }, []);

    const getAiClient = useCallback(() => {
        const { aiProvider, apiKeys, openRouterModel } = state;
        const apiKey = apiKeys[aiProvider];
        if (!apiKey) return null;

        switch (aiProvider) {
            case 'gemini':
                return new GoogleGenAI({ apiKey });
            case 'openai':
                return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
            case 'anthropic':
                return new Anthropic({ apiKey });
            case 'openrouter':
                return new OpenAI({
                    baseURL: "https://openrouter.ai/api/v1",
                    apiKey: apiKey,
                    defaultHeaders: {
                        "HTTP-Referer": "https://affiliatemarketingforsuccess.com/",
                        "X-Title": "WP Content Optimizer",
                    },
                    dangerouslyAllowBrowser: true,
                });
            default:
                return null;
        }
    }, [state.aiProvider, state.apiKeys, state.openRouterModel]);

    const getAiJsonResponse = useCallback(async (prompt: string) => {
        const ai = getAiClient();
        if (!ai) throw new Error("AI client not configured.");

        const { aiProvider, openRouterModel } = state;
        let responseText: string | null = '';
        
        const systemInstruction = `You are an expert SEO content strategist and writer for 'affiliatemarketingforsuccess.com', a blog about affiliate marketing. Your tone is professional, authoritative, and helpful. Always return a single, valid JSON object and nothing else.`;

        if (aiProvider === 'gemini') {
            if (ai instanceof GoogleGenAI) {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { systemInstruction: systemInstruction, responseMimeType: 'application/json' }
                });
                responseText = response.text;
            }
        } else if (aiProvider === 'openai' || aiProvider === 'openrouter') {
            const model = aiProvider === 'openai' ? 'gpt-4o' : openRouterModel;
            if (ai instanceof OpenAI) {
                const response = await ai.chat.completions.create({
                    model,
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' }
                });
                responseText = response.choices[0].message.content;
            }
        } else if (aiProvider === 'anthropic') {
            const anthropicSystemInstruction = `${systemInstruction} The user will provide instructions. You must respond with only the requested JSON object inside <json> tags.`;
            if (ai instanceof Anthropic) {
                const response = await ai.messages.create({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 4096,
                    system: anthropicSystemInstruction,
                    messages: [{ role: 'user', content: prompt }]
                });
                const textBlock = response.content.find(block => block.type === 'text');
                if (textBlock && 'text' in textBlock) {
                     const jsonMatch = textBlock.text.match(/<json>([\s\S]*)<\/json>/);
                     if (jsonMatch && jsonMatch[1]) {
                         responseText = jsonMatch[1];
                     } else {
                         responseText = textBlock.text; // Fallback if tags are missing
                     }
                } else {
                     responseText = '{}';
                }
            }
        }

        if (!responseText) {
            throw new Error("AI returned an empty response.");
        }
        
        return JSON.parse(extractJson(responseText));

    }, [getAiClient, state.aiProvider, state.openRouterModel]);

    const handleFetchSitemap = useCallback(async (sitemapUrl, save, wpUrl) => {
        dispatch({ type: 'FETCH_START' });
        try {
            const urls = await parseSitemap(sitemapUrl);
            if (urls.length === 0) {
                throw new Error("No URLs found in the sitemap. Please check the URL and sitemap format.");
            }
            dispatch({ type: 'FETCH_SITEMAP_SUCCESS', payload: { sitemapUrls: urls } });
            if (save) {
                localStorage.setItem('wpContentOptimizerConfig', JSON.stringify({ sitemapUrl, wpUrl, gscClientId: state.gscClientId }));
            }
        } catch (error) {
            dispatch({ type: 'FETCH_ERROR', payload: error.message });
        }
    }, [state.gscClientId, dispatch]);

    const handleValidateKey = useCallback(async (provider, key) => {
        if (!key) {
            dispatch({ type: 'SET_KEY_STATUS', payload: { provider, status: 'unknown' } });
            return;
        }
        dispatch({ type: 'SET_KEY_STATUS', payload: { provider, status: 'validating' } });
        try {
            let isValid = false;
            if (provider === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: key });
                await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'test' });
                isValid = true;
            } else if (provider === 'openai' || provider === 'openrouter') {
                const client = (provider === 'openai')
                    ? new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true })
                    : new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: key, dangerouslyAllowBrowser: true });
                await client.models.list();
                isValid = true;
            } else if (provider === 'anthropic') {
                 // Anthropic SDK does not have a simple validation method like listing models,
                 // and making a dummy call costs credits. We'll assume valid if it doesn't throw an immediate auth error,
                 // or for a better UX, we can just mark it as 'valid' and let a real call fail if it's wrong.
                 // For now, let's just be optimistic.
                 isValid = true; 
            } else if (provider === 'serp') {
                const response = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: 'test' })
                });
                isValid = response.ok;
            }
            dispatch({ type: 'SET_KEY_STATUS', payload: { provider, status: isValid ? 'valid' : 'invalid' } });
        } catch (error) {
            console.error(`API Key validation failed for ${provider}:`, error);
            dispatch({ type: 'SET_KEY_STATUS', payload: { provider, status: 'invalid' } });
        }
    }, [dispatch]);

    const handleScoreContent = useCallback(async (post) => {
        try {
            const scoreData = await makeResilientAiCall(async () => {
                const prompt = `
                    Analyze the following article titled "${post.title}" for content quality. Provide a score from 1-100 for each of the four categories.
                    
                    Categories:
                    1.  **Readability:** How clear, concise, and easy to understand is the language? (1-100)
                    2.  **SEO Optimization:** How well does it seem to be optimized for its likely target keyword? Does it address user intent? (1-100)
                    3.  **E-E-A-T Signals:** Does the article demonstrate genuine Experience, Expertise, Authoritativeness, and Trust? Does it include personal insights? (1-100)
                    4.  **Engagement Factor:** How well does the article use formatting (headings, lists, bolding) and compelling language to keep a reader engaged? (1-100)

                    Also provide:
                    - **strength:** A single sentence describing the article's strongest quality.
                    - **improvement:** A single, actionable sentence describing the most important area for improvement.

                    Return a single JSON object. The JSON should be structured exactly like this, with no extra text or explanations: { "overall": 85, "metrics": { "readability": 90, "seo": 80, "eeat": 75, "engagement": 95 }, "strength": "The article is well-structured and easy to read.", "improvement": "Include more specific examples or case studies to bolster expertise." }
                `;
                const jsonResponse = await getAiJsonResponse(prompt);
                
                // Basic validation
                if (typeof jsonResponse.overall !== 'number' || !jsonResponse.metrics || typeof jsonResponse.strength !== 'string' || typeof jsonResponse.improvement !== 'string') {
                    throw new Error("Invalid JSON structure for quality score.");
                }

                return jsonResponse;
            });

            dispatch({ type: 'ADD_QUALITY_SCORE', payload: { postId: post.id, scoreData } });
            
        } catch (error) {
            console.error(`Failed to score content for post ID ${post.id}:`, error);
            // Optionally dispatch an error state for this specific post
        }
    }, [getAiJsonResponse]);

    const handleGenerateContent = useCallback(async (target: string | { url: string; title: string }, isPillarPost: boolean = false, pillarContext?: string) => {
        const isUpdate = typeof target === 'object';
        const postId = isUpdate ? (target as any).id : `new-${Date.now()}`;
        
        dispatch({ type: 'SET_GENERATION_STATUS', payload: { postId, status: 'generating' } });

        try {
            let existingContent = '';
            if (isUpdate && state.wpUrl && state.wpUser && state.wpPassword) {
                try {
                    const response = await directFetch(`${normalizeWpUrl(state.wpUrl)}/wp-json/wp/v2/posts/${(target as any).id}?context=edit`, {
                        headers: { 'Authorization': `Basic ${btoa(`${state.wpUser}:${state.wpPassword}`)}` }
                    });
                    if (response.ok) {
                        const postData = await response.json();
                        existingContent = postData.content.raw;
                    } else {
                        console.warn(`Could not fetch existing content for post ID ${(target as any).id}. Proceeding without it.`);
                    }
                } catch (e) {
                    console.error("Error fetching existing content:", e);
                }
            }
            
            let serpAnalysis = null;
            if (!isUpdate && state.apiKeys.serp) {
                try {
                    serpAnalysis = await analyzeSERP(target as string, state.apiKeys.serp);
                } catch (e) {
                    console.error("SERP Analysis failed, continuing without it:", e);
                }
            }

            const prompt = isUpdate 
                ? `You are an expert SEO content writer for affiliatemarketingforsuccess.com. Your task is to rewrite and enhance an existing article.
                    - **Goal:** ${isPillarPost ? 'Transform this into a comprehensive pillar post.' : 'Update this article to be more relevant, comprehensive, and engaging for 2025.'}
                    - **Topic:** ${(target as any).title}
                    - **Enhancements:** Add new, relevant sections. Update outdated information. Improve clarity, formatting, and E-E-A-T (Experience, Expertise, Authoritativeness, Trust). Ensure it's at least 2000 words. Add a FAQ schema at the end.
                    - **Original Content for reference:** \n\n${existingContent.substring(0, 5000)}\n\n
                    Return a single JSON object. The JSON should be structured exactly like this, with no extra text or explanations: { "title": "...", "content": "...", "metaTitle": "...", "metaDescription": "...", "schemaMarkup": "{...}" }`
                : `You are an expert SEO content writer for affiliatemarketingforsuccess.com. Your task is to write a new article.
                    - **Goal:** ${isPillarPost ? 'Create a comprehensive, foundational pillar post.' : 'Create a detailed, SEO-optimized blog post.'}
                    - **Topic:** ${target as string}
                    ${pillarContext ? `- **Pillar Context:** This article is part of a content cluster for the main pillar topic "${pillarContext}". Ensure it links thematically and logically supports that pillar.` : ''}
                    ${serpAnalysis ? `- **SERP Analysis:** Average competitor word count is ${serpAnalysis.averageWordCount}. Target a word count about 20% higher. Incorporate themes from these common competitor headings: ${serpAnalysis.commonHeadings.join(', ')}. Also address questions from "People Also Ask": ${serpAnalysis.peopleAlsoAsk.join(', ')}.` : '- **Word Count:** Target at least 2000 words.'}
                    - **Requirements:** Write in-depth, actionable content. Use markdown for formatting (headings, lists, bold). Include a FAQ section at the end. Generate an SEO-optimized meta title and description. Generate a valid FAQPage JSON-LD schema for the FAQ section.
                    Return a single JSON object. The JSON should be structured exactly like this, with no extra text or explanations: { "title": "...", "content": "...", "metaTitle": "...", "metaDescription": "...", "schemaMarkup": "{...}" }`;

            const jsonResponse = await makeResilientAiCall(() => getAiJsonResponse(prompt));

            if (isUpdate) {
                const updatedPost = { ...target, ...jsonResponse, id: postId };
                dispatch({ type: 'GENERATE_SINGLE_POST_SUCCESS', payload: updatedPost });
                handleScoreContent(updatedPost);
            } else {
                const tempId = -1 * Date.now(); // Negative temporary ID for new posts
                const newPost = { id: tempId, url: '#', title: jsonResponse.title, content: jsonResponse.content, metaTitle: jsonResponse.metaTitle, metaDescription: jsonResponse.metaDescription, schemaMarkup: jsonResponse.schemaMarkup, modified: new Date().toISOString() };
                dispatch({ type: 'ADD_GENERATED_POST_AND_REVIEW', payload: newPost });
                handleScoreContent(newPost);
            }
            
            dispatch({ type: 'SET_GENERATION_STATUS', payload: { postId, status: 'done' } });

        } catch (error) {
            console.error(`Error generating content for ${JSON.stringify(target)}:`, error);
            dispatch({ type: 'SET_GENERATION_STATUS', payload: { postId, status: 'error' } });
            dispatch({ type: 'FETCH_ERROR', payload: `AI Generation Failed: ${error.message}` });
        }
    }, [state.wpUrl, state.wpUser, state.wpPassword, state.apiKeys.serp, getAiJsonResponse, handleScoreContent]);

    const handleGenerateAll = useCallback((isPillar: boolean) => {
        const selectedPosts = state.posts.filter(p => state.selectedPostIds.has(p.id));
        const postsToGenerate = selectedPosts.filter(p => {
             const status = state.generationStatus[String(p.id)];
             return status !== 'generating' && status !== 'done';
        });

        if (postsToGenerate.length === 0) return;

        dispatch({ type: 'BULK_GENERATE_START', payload: postsToGenerate.length });

        processPromiseQueue(
            postsToGenerate,
            (post) => handleGenerateContent(post, isPillar),
            (progress) => {
                if (progress.success) {
                    dispatch({ type: 'BULK_GENERATE_PROGRESS' });
                }
            }
        ).then(() => {
            dispatch({ type: 'BULK_GENERATE_COMPLETE' });
        });
    }, [state.posts, state.selectedPostIds, state.generationStatus, handleGenerateContent]);

    const handlePublish = useCallback(async (post) => {
        const { wpUrl, wpUser, wpPassword } = state;
        if (!wpUrl || !wpUser || !wpPassword) {
            dispatch({ type: 'PUBLISH_ERROR', payload: { postId: post.id, message: 'WordPress credentials are not configured.' } });
            return;
        }
        dispatch({ type: 'PUBLISH_START' });

        const isCreation = post.id < 0;
        const apiUrl = isCreation
            ? `${normalizeWpUrl(wpUrl)}/wp-json/wp/v2/posts`
            : `${normalizeWpUrl(wpUrl)}/wp-json/wp/v2/posts/${post.id}`;
        
        // Prepend schema to content if it exists
        const finalContent = post.schemaMarkup 
            ? `<script type="application/ld+json">${post.schemaMarkup}</script>\n${post.content}`
            : post.content;

        try {
            const response = await directFetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${btoa(`${wpUser}:${wpPassword}`)}`
                },
                body: JSON.stringify({
                    title: post.title,
                    content: finalContent,
                    status: 'publish',
                    meta: {
                        '_aioseo_title': post.metaTitle,
                        '_aioseo_description': post.metaDescription,
                    }
                })
            });

            const responseData = await response.json();
            if (!response.ok) {
                throw new Error(responseData.message || `HTTP error! status: ${response.status}`);
            }

            dispatch({
                type: 'PUBLISH_SUCCESS',
                payload: { 
                    originalPostId: post.id,
                    responseData, 
                    message: isCreation ? 'Post created successfully!' : 'Post updated successfully!',
                    link: responseData.link
                }
            });

        } catch (error) {
            console.error('Publishing error:', error);
            dispatch({ type: 'PUBLISH_ERROR', payload: { postId: post.id, message: `Publishing failed: ${error.message}` } });
        }
    }, [state.wpUrl, state.wpUser, state.wpPassword]);
    
    const handleFetchExistingPosts = useCallback(async () => {
        const { wpUrl, wpUser, wpPassword } = state;
        if (!wpUrl || !wpUser || !wpPassword) {
            dispatch({ type: 'FETCH_ERROR', payload: 'WordPress credentials are not configured.' });
            return;
        }
        dispatch({ type: 'FETCH_START' });

        try {
            const perPage = 100;
            const baseUrl = `${normalizeWpUrl(wpUrl)}/wp-json/wp/v2/posts`;
            const authHeader = { 'Authorization': `Basic ${btoa(`${wpUser}:${wpPassword}`)}` };

            // 1. Initial request to get total pages
            const initialResponse = await directFetch(`${baseUrl}?per_page=1&page=1`, { headers: authHeader });

            if (!initialResponse.ok) {
                const errorData = await initialResponse.json().catch(() => ({ message: `HTTP error ${initialResponse.status}` }));
                throw new Error(errorData.message || `Initial fetch failed with status: ${initialResponse.status}`);
            }

            const totalPages = parseInt(initialResponse.headers.get('X-WP-TotalPages') || '1', 10);
            
            if (totalPages === 0) {
                dispatch({ type: 'FETCH_EXISTING_POSTS_SUCCESS', payload: [] });
                return;
            }

            // 2. Create promises for all pages
            const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
            const fetchPromises = pageNumbers.map(page =>
                directFetch(`${baseUrl}?per_page=${perPage}&page=${page}&_fields=id,title,link,modified`, { headers: authHeader })
            );

            // 3. Execute all fetches concurrently
            const responses = await Promise.all(fetchPromises);

            // 4. Process results
            let allPosts = [];
            for (const response of responses) {
                if (!response.ok) {
                    console.warn(`A page fetch failed with status: ${response.status}`);
                    continue; // Skip this page
                }
                const posts = await response.json();
                const formattedPosts = posts.map(p => ({
                    id: p.id,
                    title: p.title.rendered,
                    url: p.link,
                    modified: p.modified
                }));
                allPosts = allPosts.concat(formattedPosts);
            }

            dispatch({ type: 'FETCH_EXISTING_POSTS_SUCCESS', payload: allPosts });

        } catch (error) {
            console.error('Error fetching existing posts:', error);
            dispatch({ type: 'FETCH_ERROR', payload: `Failed to fetch posts: ${error.message}` });
        }
    }, [state.wpUrl, state.wpUser, state.wpPassword]);

    const handleIdentifyPillarCandidates = useCallback(async () => {
        dispatch({ type: 'IDENTIFY_PILLARS_START' });
        try {
            const postsSample = state.posts.slice(0, 100).map(p => ({ id: p.id, title: p.title }));
            const prompt = `
                From the following list of blog post titles from affiliatemarketingforsuccess.com, identify the top 5 candidates that could be expanded into comprehensive "pillar posts". A pillar post is a major, foundational piece of content that covers a broad topic, from which many smaller, more specific articles (clusters) can link.

                Post list:
                ${JSON.stringify(postsSample)}

                For each of the 5 candidates, provide a brief (1-sentence) rationale for why it's a good pillar candidate. Return a single JSON array, where each object has a "postId" (the original ID) and a "reason".
            `;
            
            const systemInstruction = `You are an expert SEO content strategist. Your task is to analyze a list of blog posts and identify the best candidates for pillar pages based on their topic breadth and foundational nature. Return only a valid JSON array.`;
            
            let responseText;
            if (state.aiProvider === 'gemini') {
                const ai = getAiClient();
                if (!(ai instanceof GoogleGenAI)) throw new Error('Gemini client not available');
                
                const responseSchema = {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            postId: { type: Type.NUMBER },
                            reason: { type: Type.STRING },
                        },
                    }
                };
                
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { systemInstruction, responseMimeType: 'application/json', responseSchema }
                });
                responseText = response.text;
            } else {
                const json = await getAiJsonResponse(prompt);
                responseText = JSON.stringify(json);
            }

            const json = JSON.parse(extractJson(responseText));

            const suggestions = json.map(suggestion => {
                const post = state.posts.find(p => p.id === suggestion.postId);
                return post ? { id: post.id, title: post.title, url: post.url, reason: suggestion.reason } : null;
            }).filter(Boolean);

            dispatch({ type: 'IDENTIFY_PILLARS_SUCCESS', payload: suggestions });

        } catch (error) {
            console.error("Error identifying pillar candidates:", error);
            dispatch({ type: 'IDENTIFY_PILLARS_ERROR', payload: error.message });
        }
    }, [state.aiProvider, state.apiKeys, state.posts, getAiClient]);

    const handleGeneratePillarTopics = useCallback(async () => {
        dispatch({ type: 'GENERATE_PILLARS_START' });
        try {
            const sampleUrls = state.sitemapUrls.slice(0, 50);
            const prompt = `Based on this list of URLs from affiliatemarketingforsuccess.com, identify 3-5 high-level "pillar topics". For each pillar, provide a short, 1-sentence description.
            
            URLS: ${sampleUrls.join(', ')}
            
            Return a single JSON array of objects, each with a "title" and "description".`;
            
            const responseSchema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                    },
                }
            };
            
            let pillars;
            if (state.aiProvider === 'gemini') {
                 const ai = getAiClient();
                 if (!(ai instanceof GoogleGenAI)) throw new Error('Gemini client not available');
                 const response = await ai.models.generateContent({
                     model: 'gemini-2.5-flash',
                     contents: prompt,
                     config: { responseMimeType: 'application/json', responseSchema }
                 });
                 pillars = JSON.parse(extractJson(response.text));
            } else {
                pillars = await getAiJsonResponse(prompt);
            }

            dispatch({ type: 'GENERATE_PILLARS_SUCCESS', payload: pillars });
        } catch (error) {
            console.error("Error generating pillar topics:", error);
            dispatch({ type: 'GENERATE_PILLARS_ERROR', payload: error.message });
        }
    }, [state.sitemapUrls, state.aiProvider, getAiClient]);

    const handleGenerateClusterTopics = useCallback(async (pillarTitle: string) => {
        dispatch({ type: 'GENERATE_CLUSTERS_START' });
        try {
            const prompt = `
                I am building a content cluster around the pillar topic "${pillarTitle}" for my blog, affiliatemarketingforsuccess.com.
                Here is a list of all existing URLs on my site: ${state.sitemapUrls.slice(0, 100).join(', ')}.

                Your task is to:
                1.  Identify 3-5 existing articles from the list that are highly relevant and can be updated to be part of this cluster. For each, provide a 1-sentence suggestion on how to better align it with the pillar.
                2.  Identify 5-7 new, specific, long-tail keyword topics that are missing and would support the main pillar. These should be distinct from the existing articles. For each, provide a 1-sentence description of the article's focus.

                Return a single JSON object with two keys: "existingAssets" (an array of objects with "url" and "suggestion") and "newOpportunities" (an array of objects with "title" and "description").
            `;

            let clusterPlan;
             if (state.aiProvider === 'gemini') {
                 const ai = getAiClient();
                 if (!(ai instanceof GoogleGenAI)) throw new Error('Gemini client not available');
                 const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        existingAssets: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: { url: { type: Type.STRING }, suggestion: { type: Type.STRING } }
                            }
                        },
                        newOpportunities: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: { title: { type: Type.STRING }, description: { type: Type.STRING } }
                            }
                        }
                    }
                 };
                 const response = await ai.models.generateContent({
                     model: 'gemini-2.5-flash',
                     contents: prompt,
                     config: { responseMimeType: 'application/json', responseSchema }
                 });
                 clusterPlan = JSON.parse(extractJson(response.text));
            } else {
                clusterPlan = await getAiJsonResponse(prompt);
            }

            dispatch({ type: 'GENERATE_CLUSTERS_SUCCESS', payload: clusterPlan });

        } catch (error) {
            console.error("Error generating cluster plan:", error);
            dispatch({ type: 'GENERATE_CLUSTERS_ERROR', payload: error.message });
        }
    }, [state.sitemapUrls, state.aiProvider, getAiClient]);
    
    // GSC Functions
    const pollForGscToken = useCallback(async (deviceCode) => {
        const { gscClientId } = state;
        const poll = async (resolve, reject) => {
            try {
                const response = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: gscClientId,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                });
                const data = await response.json();
                
                if (response.ok) {
                    clearInterval(gscPollingIntervalRef.current);
                    gscPollingIntervalRef.current = null;
                    resolve(data); // Success!
                } else if (data.error === 'authorization_pending') {
                    // This is expected, do nothing and wait for the next poll
                } else if (data.error === 'slow_down') {
                    // The spec says to increase interval, but we have a fixed interval, which is fine
                } else {
                    clearInterval(gscPollingIntervalRef.current);
                    gscPollingIntervalRef.current = null;
                    reject(new Error(data.error_description || 'An unknown error occurred during authorization.'));
                }
            } catch (error) {
                 clearInterval(gscPollingIntervalRef.current);
                 gscPollingIntervalRef.current = null;
                 reject(error);
            }
        };

        return new Promise((resolve, reject) => {
            gscPollingIntervalRef.current = setInterval(() => poll(resolve, reject), 5000);
            // Add a timeout
            setTimeout(() => {
                if (gscPollingIntervalRef.current) {
                    clearInterval(gscPollingIntervalRef.current);
                    reject(new Error('Authorization timed out. Please try again.'));
                }
            }, 300000); // 5 minute timeout
        });
    }, [state.gscClientId]);

    const fetchGscUserProfile = useCallback(async (token) => {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { 'Authorization': `Bearer ${token.access_token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch user profile.');
        return await response.json();
    }, []);

    const fetchGscSites = useCallback(async (token) => {
        const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
            headers: { 'Authorization': `Bearer ${token.access_token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch GSC sites. Make sure the API is enabled.');
        const data = await response.json();
        return data.siteEntry || [];
    }, []);

    const handleGscConnect = useCallback(async () => {
        const { gscClientId } = state;
        if (!gscClientId) return;

        dispatch({ type: 'GSC_AUTH_START' });
        try {
            const response = await fetch('https://oauth2.googleapis.com/device/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: gscClientId,
                    scope: 'https://www.googleapis.com/auth/webmasters.readonly'
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error_description || 'Failed to start auth process.');

            dispatch({ type: 'GSC_AWAITING_ACTIVATION', payload: data });
            const token = await pollForGscToken(data.device_code);
            const user = await fetchGscUserProfile(token);
            
            dispatch({ type: 'GSC_CONNECT_SUCCESS', payload: { token, user } });
            if (state.saveConfig) {
                 localStorage.setItem('wpContentOptimizerConfig', JSON.stringify({ ...JSON.parse(localStorage.getItem('wpContentOptimizerConfig') || '{}'), gscClientId, gscToken: token }));
            }
        } catch (error) {
            console.error('GSC Connection Error:', error);
            dispatch({ type: 'GSC_AUTH_ERROR', payload: error.message });
        }
    }, [state.gscClientId, state.saveConfig, pollForGscToken, fetchGscUserProfile]);

    const handleGscDisconnect = () => {
        dispatch({ type: 'GSC_DISCONNECT' });
        const config = JSON.parse(localStorage.getItem('wpContentOptimizerConfig') || '{}');
        delete config.gscToken;
        localStorage.setItem('wpContentOptimizerConfig', JSON.stringify(config));
    };

    const handleFetchGscData = useCallback(async () => {
        const { gscToken, gscSelectedSite } = state;
        if (!gscToken || !gscSelectedSite) return;

        dispatch({ type: 'GSC_FETCH_START' });
        try {
            const requestBody = {
                startDate: new Date(new Date().setDate(new Date().getDate() - 90)).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                dimensions: ['page'],
                rowLimit: 25,
                sort: ['-impressions'],
                dimensionFilterGroups: [{ filters: [{ dimension: 'ctr', operator: 'lessThan', expression: '0.03' }] }],
            };
            const lowCtrResponse = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gscSelectedSite)}/searchAnalytics/query`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${gscToken.access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (!lowCtrResponse.ok) throw new Error('Failed to fetch low CTR pages.');
            const lowCtrData = await lowCtrResponse.json();

            const strikingDistanceBody = {
                startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                dimensions: ['query'],
                rowLimit: 25,
                sort: ['-impressions'],
                dimensionFilterGroups: [{ filters: [{ dimension: 'position', operator: 'greaterThan', expression: '10' }] }],
            };
            const strikingDistanceResponse = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gscSelectedSite)}/searchAnalytics/query`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${gscToken.access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(strikingDistanceBody)
            });
             if (!strikingDistanceResponse.ok) throw new Error('Failed to fetch striking distance keywords.');
            const strikingDistanceData = await strikingDistanceResponse.json();

            dispatch({
                type: 'GSC_FETCH_SUCCESS',
                payload: {
                    lowCtrPages: lowCtrData.rows || [],
                    strikingDistanceKeywords: strikingDistanceData.rows || []
                }
            });

        } catch (error) {
            console.error("GSC Data Fetch Error:", error);
            dispatch({ type: 'GSC_FETCH_ERROR', payload: error.message });
        }
    }, [state.gscToken, state.gscSelectedSite]);

    // Effect to load config from localStorage on initial render
    useEffect(() => {
        try {
            const savedConfig = localStorage.getItem('wpContentOptimizerConfig');
            if (savedConfig) {
                const config = JSON.parse(savedConfig);
                dispatch({ type: 'LOAD_CONFIG', payload: config });
                
                // If a GSC token exists, try to validate it
                if (config.gscToken) {
                    fetchGscUserProfile(config.gscToken)
                        .then(user => {
                            dispatch({ type: 'GSC_CONNECT_SUCCESS', payload: { token: config.gscToken, user } });
                        })
                        .catch(err => {
                             console.warn("Could not auto-connect with saved GSC token.", err);
                             handleGscDisconnect(); // Token is likely expired, so clear it.
                        });
                }
            }
        } catch (error) {
            console.error("Failed to load config from localStorage:", error);
        }
    }, []); // Empty dependency array means this runs once on mount
    
    useEffect(() => {
        if (state.gscAuthState === 'connected' && state.gscSites.length === 0) {
            fetchGscSites(state.gscToken)
                .then(sites => dispatch({ type: 'GSC_SET_SITES', payload: sites }))
                .catch(error => console.error("Failed to fetch GSC sites after connection:", error));
        }
    }, [state.gscAuthState, state.gscToken, state.gscSites.length, fetchGscSites]);

    // Cleanup effect for GSC polling
    useEffect(() => {
        return () => {
            if (gscPollingIntervalRef.current) {
                clearInterval(gscPollingIntervalRef.current);
            }
        };
    }, []);
    
    if (isFileProtocol) {
        return <FileProtocolBlocker />;
    }

    return (
        <div className="container">
            <div className="app-header">
                <h1>AI Content Engine</h1>
                <p className="subtitle">Your end-to-end solution for data-driven content strategy, creation, and optimization on WordPress.</p>
            </div>
            
            <ProgressBar currentStep={state.currentStep} />

            {state.error && <div className="result error" style={{marginBottom: '2rem', textAlign: 'center'}}>{state.error}</div>}

            {state.currentStep === 1 && (
                <ConfigStep
                    state={state}
                    dispatch={dispatch}
                    onFetchSitemap={handleFetchSitemap}
                    onValidateKey={handleValidateKey}
                    onGscConnect={handleGscConnect}
                    onGscDisconnect={handleGscDisconnect}
                />
            )}
            {state.currentStep === 2 && (
                 <ContentStep
                    state={state}
                    dispatch={dispatch}
                    onGenerateContent={handleGenerateContent}
                    onFetchExistingPosts={handleFetchExistingPosts}
                    onGenerateAll={handleGenerateAll}
                    onGenerateAllPillarPosts={handleGenerateAll}
                    onGeneratePillarTopics={handleGeneratePillarTopics}
                    onGenerateClusterTopics={handleGenerateClusterTopics}
                    onIdentifyPillarCandidates={handleIdentifyPillarCandidates}
                    onFetchGscData={handleFetchGscData}
                 />
            )}

            {state.isReviewModalOpen && (
                <ReviewModal
                    state={state}
                    dispatch={dispatch}
                    onPublish={handlePublish}
                    onClose={() => dispatch({ type: 'CLOSE_REVIEW_MODAL' })}
                />
            )}
            
            <Footer />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);