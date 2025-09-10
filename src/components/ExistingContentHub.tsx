import React, { useState, useEffect } from 'react';
import { VirtualizedContentTable } from './VirtualizedContentTable';
import { RankGuardianPane } from './RankGuardianPane';
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
  const [showRankGuardian, setShowRankGuardian] = useState(false);
  const [currentContent, setCurrentContent] = useState('');

  const { 
    entries, 
    isLoading: isFetchingPosts, 
    progress, 
    error, 
    crawledCount, 
    totalCount, 
    discoverAndParseSitemap 
  } = useSitemapParser();
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
      // Remove duplicates using URL as the key
      const uniqueEntries = Array.from(
        new Map(entries.map(entry => [entry.url, entry])).values()
      );
      
      const convertedPosts: WordPressPost[] = uniqueEntries.map((entry, index) => {
        const title = entry.title || extractTitleFromUrl(entry.url);
        const isStale = entry.isStale || (entry.lastModified ? 
          new Date(entry.lastModified) < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : 
          false);
        
        return {
          id: index + 1,
          title,
          slug: entry.url.split('/').pop() || `post-${index + 1}`,
          status: 'idle' as const,
          lastModified: entry.lastModified || new Date().toISOString(),
          wordCount: entry.wordCount || 0,
          url: entry.url,
          isStale,
          mainContent: entry.mainContent
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
        contentType: 'pillar'
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

  const handleShowRankGuardian = (content: string) => {
    setCurrentContent(content);
    setShowRankGuardian(true);
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
           {/* Real-time progress display */}
            <div className="bulk-progress-bar">
              <div 
                className="bulk-progress-bar-fill" 
                style={{ 
                  width: totalCount > 0 ? `${(crawledCount / totalCount) * 100}%` : '100%',
                  background: totalCount > 0 ? 
                    'linear-gradient(90deg, #8b5cf6, #3b82f6)' : 
                    'linear-gradient(90deg, #facc15, #f59e0b)'
                }}
              ></div>
              <div className="bulk-progress-bar-text">
                {totalCount > 0 ? `${crawledCount}/${totalCount} pages analyzed` : progress}
              </div>
            </div>
           
           {/* Detailed progress info */}
           <div style={{ 
             textAlign: 'center', 
             fontSize: '0.9rem', 
             color: 'var(--text-light-color)', 
             marginTop: '0.5rem' 
           }}>
             {progress}
           </div>
          </div>
        )}
        
        {error && (
          <div className="result error">
            <strong>Sitemap Discovery Failed:</strong> {error}
            <br />
            <small>
             Our advanced crawler tried multiple proxy servers and sitemap locations. 
             Please verify your site URL is accessible and has XML sitemaps enabled.
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
             {totalCount > 0 ? `Analyzing Pages (${crawledCount}/${totalCount})` : 'Professional Crawling...'}
            </>
          ) : (
           '🚀 Start Advanced Sitemap Crawl'
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
         Advanced crawl discovered {posts.length} pages with full content analysis. Select posts to optimize with AI-generated improvements.
        </p>
        
        {entries.length > 0 && (
          <div className="result success" style={{ marginBottom: '2rem' }}>
           🎉 Professional crawl complete: {entries.length} pages analyzed with content extraction, stale detection, and SEO insights
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
      
      <RankGuardianPane
        content={currentContent}
        targetKeyword={searchTerm}
        isVisible={showRankGuardian}
        onClose={() => setShowRankGuardian(false)}
      />
    </div>
  );
};

export default ExistingContentHub;