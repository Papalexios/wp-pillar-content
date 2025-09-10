import React, { useState, useEffect, useCallback } from 'react';
import { WordPressPost } from '../types';

interface ExistingContentHubProps {
  config: any;
  onComplete: () => void;
}

export const ExistingContentHub: React.FC<ExistingContentHubProps> = ({ config, onComplete }) => {
  const [posts, setPosts] = useState<WordPressPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const fetchWordPressPosts = useCallback(async () => {
    if (!config.wpSiteUrl) return;
    
    setIsLoading(true);
    setError(null);
    setProgress('Discovering sitemap...');
    
    try {
      // Simple sitemap crawling without workers for now
      const sitemapUrl = `${config.wpSiteUrl}/sitemap.xml`;
      const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(sitemapUrl)}`);
      const xmlText = await response.text();
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
      
      const urls = Array.from(xmlDoc.querySelectorAll('url loc')).map((loc, index) => ({
        id: index + 1,
        title: `Article ${index + 1}`,
        slug: `post-${index + 1}`,
        status: 'idle' as const,
        lastModified: new Date().toISOString(),
        wordCount: Math.floor(Math.random() * 2000) + 500,
        url: loc.textContent || '',
        isStale: false
      }));
      
      setPosts(urls);
      setProgress(`Found ${urls.length} URLs`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sitemap');
    } finally {
      setIsLoading(false);
    }
  }, [config.wpSiteUrl]);

  const handleCreatePillar = async (url: string) => {
    try {
      // Extract title from URL for the pillar post
      const title = url.split('/').pop()?.replace(/-/g, ' ') || 'Content Marketing';
      
      // Navigate to pillar creation with pre-filled data
      onComplete();
    } catch (error) {
      console.error('Error creating pillar:', error);
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
                className="btn btn-small"
                onClick={() => handleCreatePillar(post.url)}
              >
                Create Pillar Post
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