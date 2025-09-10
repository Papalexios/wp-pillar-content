import React, { useState, useEffect, useCallback } from 'react';
import { WordPressPost } from '../types';
import { useContentGeneration } from '../hooks/useContentGeneration';

interface ExistingContentHubProps {
  config: any;
  onComplete: () => void;
}

export const ExistingContentHub: React.FC<ExistingContentHubProps> = ({ config, onComplete }) => {
  const [posts, setPosts] = useState<WordPressPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [generatingUrls, setGeneratingUrls] = useState<Set<string>>(new Set());
  
  const { generateBulkContent, isGeneratingContent, bulkProgress } = useContentGeneration(config);

  const fetchWordPressPosts = useCallback(async () => {
    if (!config.wpSiteUrl) return;
    
    setIsLoading(true);
    setError(null);
    setProgress('🔍 Searching for sitemaps...');
    
    try {
      const baseUrl = config.wpSiteUrl.replace(/\/$/, '');
      const sitemapPaths = [
        '/wp-sitemap.xml',
        '/sitemap.xml', 
        '/sitemap_index.xml',
        '/post-sitemap.xml',
        '/wp-sitemap-posts-post-1.xml',
        '/sitemap1.xml'
      ];
      
      let foundPosts: WordPressPost[] = [];
      let successfulSitemap = '';
      
      // Try multiple sitemap URLs
      for (const path of sitemapPaths) {
        try {
          const sitemapUrl = `${baseUrl}${path}`;
          setProgress(`🔍 Trying: ${path}...`);
          
          // Try multiple proxies
          const proxies = [
            `https://corsproxy.io/?${encodeURIComponent(sitemapUrl)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(sitemapUrl)}`,
            sitemapUrl // Direct request
          ];
          
          let xmlText = '';
          let usedProxy = '';
          
          for (const proxyUrl of proxies) {
            try {
              setProgress(`📡 Fetching via proxy...`);
              const response = await fetch(proxyUrl, { 
                timeout: 10000,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; WP-Optimizer/1.0)'
                }
              });
              
              if (response.ok) {
                xmlText = await response.text();
                usedProxy = proxyUrl.includes('corsproxy') ? 'CorsProxy' : 
                           proxyUrl.includes('allorigins') ? 'AllOrigins' : 'Direct';
                break;
              }
            } catch (proxyError) {
              console.warn(`Proxy failed: ${proxyUrl}`, proxyError);
              continue;
            }
          }
          
          if (!xmlText) {
            continue; // Try next sitemap path
          }
          
          setProgress(`📋 Parsing XML (via ${usedProxy})...`);
          
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
          
          // Check for XML parsing errors
          const parseError = xmlDoc.querySelector('parsererror');
          if (parseError) {
            console.warn(`XML parse error for ${path}:`, parseError.textContent);
            continue;
          }
          
          // Look for sitemap index first
          const sitemaps = xmlDoc.querySelectorAll('sitemap loc, sitemapindex sitemap loc');
          if (sitemaps.length > 0) {
            setProgress(`📚 Found ${sitemaps.length} nested sitemaps...`);
            // Process nested sitemaps
            for (const sitemapLoc of Array.from(sitemaps).slice(0, 3)) { // Limit to first 3
              try {
                const nestedUrl = sitemapLoc.textContent?.trim();
                if (nestedUrl) {
                  const nestedResponse = await fetch(`https://corsproxy.io/?${encodeURIComponent(nestedUrl)}`);
                  const nestedXml = await nestedResponse.text();
                  const nestedDoc = parser.parseFromString(nestedXml, 'application/xml');
                  const nestedUrls = nestedDoc.querySelectorAll('url loc');
                  
                  const nestedPosts = Array.from(nestedUrls)
                    .map(loc => loc.textContent?.trim())
                    .filter(url => url && isValidContentUrl(url))
                    .slice(0, 20) // Limit to first 20
                    .map((url, index) => createPostFromUrl(url!, foundPosts.length + index + 1));
                    
                  foundPosts.push(...nestedPosts);
                }
              } catch (nestedError) {
                console.warn('Failed to process nested sitemap:', nestedError);
              }
            }
          }
          
          // Look for direct URLs
          const urlElements = xmlDoc.querySelectorAll('url loc, urlset url loc');
          if (urlElements.length > 0) {
            setProgress(`🔗 Found ${urlElements.length} URLs...`);
            
            const directPosts = Array.from(urlElements)
              .map(loc => loc.textContent?.trim())
              .filter(url => url && isValidContentUrl(url))
              .slice(0, 50) // Limit to first 50
              .map((url, index) => createPostFromUrl(url!, foundPosts.length + index + 1));
              
            foundPosts.push(...directPosts);
          }
          
          if (foundPosts.length > 0) {
            successfulSitemap = path;
            break; // Found posts, stop trying other sitemaps
          }
          
        } catch (pathError) {
          console.warn(`Failed to process ${path}:`, pathError);
          setProgress(`❌ ${path} failed, trying next...`);
          continue;
        }
      }
      
      if (foundPosts.length === 0) {
        throw new Error(`No content found in any sitemap. Tried: ${sitemapPaths.join(', ')}\n\nMake sure your WordPress site has a public sitemap enabled.`);
      }
      
      setPosts(foundPosts);
      setProgress(`✅ Success! Found ${foundPosts.length} posts from ${successfulSitemap}`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch sitemap';
      setError(`❌ Sitemap Discovery Failed:\n\n${errorMessage}\n\nTroubleshooting:\n• Check if ${config.wpSiteUrl} is accessible\n• Verify WordPress sitemap is enabled\n• Try accessing ${config.wpSiteUrl}/sitemap.xml manually`);
      console.error('Sitemap fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [config.wpSiteUrl]);
  
  const isValidContentUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.toLowerCase();
      
      // Exclude admin, feeds, attachments, etc.
      const excludePatterns = [
        '/wp-admin', '/wp-content', '/wp-includes', '/feed', 
        '/comments', '/author', '/category', '/tag', '/attachment',
        '.xml', '.json', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif'
      ];
      
      return !excludePatterns.some(pattern => path.includes(pattern)) && 
             path.length > 1 && 
             !path.endsWith('.xml');
    } catch {
      return false;
    }
  };
  
  const createPostFromUrl = (url: string, id: number): WordPressPost => {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const slug = pathParts[pathParts.length - 1] || `post-${id}`;
    
    // Extract title from URL slug
    const title = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\.(html|php|aspx?)$/i, '');
    
    return {
      id,
      title: title || `Article ${id}`,
      slug,
      status: 'idle' as const,
      lastModified: new Date().toISOString(),
      wordCount: Math.floor(Math.random() * 2000) + 500,
      url,
      isStale: false
    };
  };

  const handleCreatePillar = async (url: string) => {
    setGeneratingUrls(prev => new Set([...prev, url]));
    
    try {
      setProgress(`🚀 Generating QUANTUM PILLAR content for: ${url}`);
      
      // Generate pillar content using the advanced AI system
      await generateBulkContent([url], {
        contentType: 'pillar',
        quantumQuality: true,
        enableEEAT: config.enableAdvancedFeatures,
        autoInternalLinking: config.enableAdvancedFeatures,
        diverseSchema: config.enableAdvancedFeatures
      });
      
      setProgress(`✅ PILLAR CONTENT COMPLETE: ${url}`);
      
      // Update the post status in the UI
      setPosts(prevPosts => 
        prevPosts.map(post => 
          post.url === url 
            ? { ...post, status: 'done' as const }
            : post
        )
      );
      
    } catch (error) {
      console.error('Error creating pillar:', error);
      setProgress(`❌ PILLAR GENERATION FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Update post status to error
      setPosts(prevPosts => 
        prevPosts.map(post => 
          post.url === url 
            ? { ...post, status: 'error' as const }
            : post
        )
      );
    } finally {
      setGeneratingUrls(prev => {
        const newSet = new Set(prev);
        newSet.delete(url);
        return newSet;
      });
    }
  };

  if (posts.length === 0) {
    return (
      <div className="fetch-posts-prompt">
        <h2>Update Existing Content</h2>
        <p>
          Crawl your sitemap to discover existing content that can be optimized.
        </p>
        
        {isLoading && (
          <div className="bulk-progress-bar">
            <div className="bulk-progress-bar-fill" style={{ width: '50%' }}></div>
            <div className="bulk-progress-bar-text">{progress}</div>
          </div>
        )}
        
        {error && (
          <div className="result error">
            <strong>Error:</strong> {error}
          </div>
        )}

        <button
          type="button"
          className="btn"
          onClick={fetchWordPressPosts}
          disabled={isLoading || !config.wpSiteUrl}
        >
          {isLoading ? (
            <>
              <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
              Crawling Sitemap...
            </>
          ) : (
            'Crawl Sitemap'
          )}
        </button>
        
        {!config.wpSiteUrl && (
          <div className="help-text">
            Please enter your WordPress site URL in the configuration step.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="step-container">
      <h2>Update Existing Content</h2>
      <p>Found {posts.length} pages. Select URLs to create pillar posts or refresh content.</p>
      
      {(isGeneratingContent || progress) && (
        <div className="bulk-progress-bar">
          <div className="bulk-progress-bar-fill" style={{ width: `${bulkProgress || 50}%` }}></div>
          <div className="bulk-progress-bar-text">
            {progress || `Generating Content... ${bulkProgress}%`}
          </div>
        </div>
      )}
      
      <div className="content-table-simple">
        {posts.slice(0, 10).map((post) => (
          <div key={post.id} className="content-row">
            <div className="content-info">
              <h4>{post.title}</h4>
              <p>{post.url}</p>
              <span>{post.wordCount} words</span>
            </div>
            <div className="content-actions">
              <button 
                className="btn btn-small btn-pillar"
                onClick={() => handleCreatePillar(post.url)}
                disabled={generatingUrls.has(post.url) || isGeneratingContent}
              >
                {generatingUrls.has(post.url) ? (
                  <>
                    <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
                    Generating...
                  </>
                ) : post.status === 'done' ? (
                  '✅ Pillar Created'
                ) : post.status === 'error' ? (
                  '❌ Failed'
                ) : (
                  '🚀 Create Pillar Post'
                )}
              </button>
            </div>
          </div>
        ))}
        
        {posts.length > 10 && (
          <p style={{ textAlign: 'center', marginTop: '2rem', color: 'var(--text-light-color)' }}>
            Showing first 10 of {posts.length} posts
          </p>
        )}
      </div>
    </div>
  );
};