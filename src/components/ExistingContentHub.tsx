import React, { useState, useEffect } from 'react';
import { VirtualizedContentTable } from './VirtualizedContentTable';
import { WordPressPost } from '../types';
import { useSitemapParser } from '../hooks/useSitemapParser';
import { useContentGeneration } from '../hooks/useContentGeneration';

interface ExistingContentHubProps {
  config: any;
  onComplete: () => void;
}

const ExistingContentHub: React.FC<ExistingContentHubProps> = ({ config, onComplete }) => {
  const [posts, setPosts] = useState<WordPressPost[]>([]);
  const [selectedPosts, setSelectedPosts] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [hasFetched, setHasFetched] = useState(false);

  const { entries, isLoading: isFetchingPosts, progress, error, discoverAndParseSitemap } = useSitemapParser();
  const { generateBulkContent, isGeneratingContent, bulkProgress } = useContentGeneration(config);

  const extractTitleFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'post';
      
      // Convert slug to title: "my-post-title" -> "My Post Title"
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/\.(html|php)$/i, '');
    } catch {
      return url;
    }
  };

  const fetchWordPressPosts = async () => {
    if (!config.wpSiteUrl) return;

    try {
      await discoverAndParseSitemap(config.wpSiteUrl);
      setHasFetched(true);
    } catch (err) {
      console.error('Error fetching posts:', err);
    }
  };

  // Convert sitemap entries to posts when entries change
  useEffect(() => {
    if (entries.length > 0) {
      const convertedPosts: WordPressPost[] = entries.map((entry, index) => {
        const title = extractTitleFromUrl(entry.url);
        const isStale = entry.lastModified ? 
          new Date(entry.lastModified) < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : 
          false;
        
        return {
          id: index + 1,
          title,
          slug: entry.url.split('/').pop() || `post-${index + 1}`,
          status: 'ready' as const,
          lastModified: entry.lastModified || new Date().toISOString(),
          wordCount: Math.floor(Math.random() * 2000) + 300, // This would be fetched from actual content
          url: entry.url,
          isStale
        };
      });

      setPosts(convertedPosts);
    }
  }, [entries]);

  const handlePostSelect = (postId: number) => {
    setSelectedPosts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(postId)) {
        newSet.delete(postId);
      } else {
        newSet.add(postId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const filteredPosts = posts.filter(post => {
        const matchesSearch = post.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || post.status === statusFilter;
        return matchesSearch && matchesStatus;
      });
      setSelectedPosts(new Set(filteredPosts.map(post => post.id)));
    } else {
      setSelectedPosts(new Set());
    }
  };

  const handleGenerateContent = async (postIds: number[]) => {
    const selectedUrls = postIds.map(id => {
      const post = posts.find(p => p.id === id);
      return post?.url || '';
    }).filter(Boolean);

    if (selectedUrls.length === 0) {
      console.error('No valid URLs found for selected posts');
      return;
    }

    try {
      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'generating' as const }
          : post
      ));

      await generateBulkContent(selectedUrls, {
        enableEEAT: config.enableAdvancedFeatures,
        autoInternalLinking: config.enableAdvancedFeatures,
        diverseSchema: config.enableAdvancedFeatures,
        contentType: 'optimize'
      });

      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'done' as const }
          : post
      ));
      
      setSelectedPosts(new Set());
    } catch (error) {
      console.error('Error generating content:', error);
      
      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'error' as const }
          : post
      ));
    }
  };

  const handleGeneratePillar = async (postIds: number[]) => {
    const selectedUrls = postIds.map(id => {
      const post = posts.find(p => p.id === id);
      return post?.url || '';
    }).filter(Boolean);

    if (selectedUrls.length === 0) {
      console.error('No valid URLs found for selected posts');
      return;
    }

    try {
      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'generating' as const }
          : post
      ));

      await generateBulkContent(selectedUrls, {
        enableEEAT: true,
        autoInternalLinking: true,
        diverseSchema: true,
        contentType: 'pillar',
        quantumQuality: true
      });

      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'done' as const }
          : post
      ));
      
      setSelectedPosts(new Set());
    } catch (error) {
      console.error('Error generating pillar content:', error);
      
      setPosts(prev => prev.map(post => 
        postIds.includes(post.id) 
          ? { ...post, status: 'error' as const }
          : post
      ));
    }
  };
  if (!hasFetched) {
    return (
      <div className="fetch-posts-prompt">
        <h2>Analyze Existing Content</h2>
        <p>
          Discover and fetch your WordPress posts from sitemaps to identify optimization opportunities.
        </p>
        
        {isFetchingPosts && (
          <div style={{ marginBottom: '2rem' }}>
            <div className="bulk-progress-bar">
              <div className="bulk-progress-bar-fill" style={{ width: '100%' }}></div>
              <div className="bulk-progress-bar-text">{progress}</div>
            </div>
          </div>
        )}
        
        {error && (
          <div className="result error">
            <strong>Sitemap Discovery Failed:</strong> {error}
            <br />
            <small>
              Make sure your WordPress site has a sitemap at one of these locations: 
              /wp-sitemap.xml, /post-sitemap.xml, /sitemap_index.xml, or /sitemap.xml
            </small>
          </div>
        )}

        <button
          type="button"
          className="btn"
          onClick={fetchWordPressPosts}
          disabled={isFetchingPosts || !config.wpSiteUrl}
        >
          {isFetchingPosts ? (
            <>
              <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
              Discovering & Fetching Posts...
            </>
          ) : (
            'Fetch WordPress Posts'
          )}
        </button>
        
        {!config.wpSiteUrl && (
          <div className="help-text" style={{ marginTop: '1rem', textAlign: 'center' }}>
            Please configure your WordPress site URL in the previous step.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="step-container full-width">
      <div style={{ marginBottom: '2rem' }}>
        <h2>Update Existing Content</h2>
        <p>
          Found {posts.length} posts from your WordPress sitemap. Select posts to optimize with AI-generated improvements.
        </p>
        
        {entries.length > 0 && (
          <div className="result success" style={{ marginBottom: '2rem' }}>
            ✅ Successfully loaded {entries.length} URLs from sitemap
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '1rem', marginBottom: '2rem' }}>
        <input
          type="text"
          className="table-search-input"
          placeholder="Search posts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="ready">Ready</option>
          <option value="generating">Generating</option>
          <option value="done">Done</option>
          <option value="error">Error</option>
          <option value="idle">Idle</option>
        </select>
      </div>

      {isGeneratingContent && (
        <div className="bulk-progress-bar">
          <div 
            className="bulk-progress-bar-fill" 
            style={{ width: `${bulkProgress}%` }}
          ></div>
          <div className="bulk-progress-bar-text">
            Updating Content... {bulkProgress}%
          </div>
        </div>
      )}

      <VirtualizedContentTable
        posts={posts}
        selectedPosts={selectedPosts}
        onPostSelect={handlePostSelect}
        onSelectAll={handleSelectAll}
        onGenerateContent={handleGenerateContent}
        onGeneratePillar={handleGeneratePillar}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
      />
    </div>
  );
};

export default ExistingContentHub;