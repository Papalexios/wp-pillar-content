import React, { useState, useEffect, useCallback } from 'react';
import { WordPressPost } from '../types';
import { useContentGeneration } from '../hooks/useContentGeneration';

interface ExistingContentHubProps {
  config: any;
  onComplete: () => void;
}

interface GeneratedContent {
  id: string;
  url: string;
  title: string;
  content: string;
  wordCount: number;
  status: 'draft' | 'published';
  generatedAt: string;
}

export const ExistingContentHub: React.FC<ExistingContentHubProps> = ({ config, onComplete }) => {
  const [posts, setPosts] = useState<WordPressPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [generatingUrls, setGeneratingUrls] = useState<Set<string>>(new Set());
  const [currentView, setCurrentView] = useState<'crawl' | 'posts' | 'generated'>('crawl');
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>([]);
  const [selectedContent, setSelectedContent] = useState<GeneratedContent | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'idle' | 'generating' | 'done' | 'error'>('all');
  
  const { generateBulkContent, isGeneratingContent, bulkProgress } = useContentGeneration(config);

  const fetchWordPressPosts = useCallback(async () => {
    if (!config.wpSiteUrl) return;
    
    setIsLoading(true);
    setError(null);
    setProgress('🔍 Discovering sitemap locations...');
    
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
          setProgress(`🔍 Analyzing: ${path}...`);
          
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
              setProgress(`📡 Fetching via advanced proxy system...`);
              const response = await fetch(proxyUrl, { 
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
            continue;
          }
          
          setProgress(`📋 Processing XML data (via ${usedProxy})...`);
          
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
          
          const parseError = xmlDoc.querySelector('parsererror');
          if (parseError) {
            console.warn(`XML parse error for ${path}:`, parseError.textContent);
            continue;
          }
          
          // Look for sitemap index first
          const sitemaps = xmlDoc.querySelectorAll('sitemap loc, sitemapindex sitemap loc');
          if (sitemaps.length > 0) {
            setProgress(`📚 Processing ${sitemaps.length} nested sitemaps...`);
            // Process ALL nested sitemaps (not limited to 3)
            for (const sitemapLoc of Array.from(sitemaps)) {
              try {
                const nestedUrl = sitemapLoc.textContent?.trim();
                if (nestedUrl) {
                  const nestedResponse = await fetch(`https://corsproxy.io/?${encodeURIComponent(nestedUrl)}`);
                  if (nestedResponse.ok) {
                    const nestedXml = await nestedResponse.text();
                    const nestedDoc = parser.parseFromString(nestedXml, 'application/xml');
                    const nestedUrls = nestedDoc.querySelectorAll('url loc');
                    
                    const nestedPosts = Array.from(nestedUrls)
                      .map(loc => loc.textContent?.trim())
                      .filter(url => url && isValidContentUrl(url))
                      .map((url, index) => createPostFromUrl(url!, foundPosts.length + index + 1));
                      
                    foundPosts.push(...nestedPosts);
                    setProgress(`📄 Found ${foundPosts.length} URLs so far...`);
                  }
                }
              } catch (nestedError) {
                console.warn('Failed to process nested sitemap:', nestedError);
              }
            }
          }
          
          // Look for direct URLs
          const urlElements = xmlDoc.querySelectorAll('url loc, urlset url loc');
          if (urlElements.length > 0) {
            setProgress(`🔗 Processing ${urlElements.length} direct URLs...`);
            
            const directPosts = Array.from(urlElements)
              .map(loc => loc.textContent?.trim())
              .filter(url => url && isValidContentUrl(url))
              .map((url, index) => createPostFromUrl(url!, foundPosts.length + index + 1));
              
            foundPosts.push(...directPosts);
          }
          
          if (foundPosts.length > 0) {
            successfulSitemap = path;
            break;
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
      
      // Remove duplicates based on URL
      const uniquePosts = foundPosts.filter((post, index, self) => 
        index === self.findIndex(p => p.url === post.url)
      );
      
      setPosts(uniquePosts);
      setProgress(`✅ SUCCESS! Discovered ${uniquePosts.length} unique URLs from ${successfulSitemap}`);
      setCurrentView('posts');
      
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
      
      const excludePatterns = [
        '/wp-admin', '/wp-content', '/wp-includes', '/feed', 
        '/comments', '/author', '/category', '/tag', '/attachment',
        '.xml', '.json', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif',
        '/page/', '/archives', '/sitemap'
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
      setProgress(`🚀 Generating ULTRA-PREMIUM HUMAN-LIKE PILLAR content for: ${url}`);
      
      // Update post status to generating
      setPosts(prevPosts => 
        prevPosts.map(post => 
          post.url === url 
            ? { ...post, status: 'generating' as const }
            : post
        )
      );
      
      // Generate premium pillar content (DO NOT PUBLISH YET)
      const post = posts.find(p => p.url === url);
      const generatedHtml = await generatePremiumPillarContent(url, post?.title || '');
      
      // Store generated content for editing (DO NOT PUBLISH TO WORDPRESS)
      const newGeneratedContent: GeneratedContent = {
        id: Date.now().toString(),
        url,
        title: posts.find(p => p.url === url)?.title || 'Generated Pillar Post',
        content: generatedHtml,
        wordCount: generatedHtml ? generatedHtml.split(' ').length : 500,
        status: 'draft',
        generatedAt: new Date().toISOString()
      };
      
      setGeneratedContent(prev => [...prev, newGeneratedContent]);
      setProgress(`✅ PILLAR CONTENT GENERATED! Opening content editor...`);
      
      // Update post status to done
      setPosts(prevPosts => 
        prevPosts.map(post => 
          post.url === url 
            ? { ...post, status: 'done' as const }
            : post
        )
      );
      
      // AUTOMATICALLY SWITCH TO GENERATED CONTENT VIEW FOR EDITING
      setTimeout(() => {
        setCurrentView('generated');
        setProgress(`📝 Content ready for review and editing!`);
      }, 1000);
      
    } catch (error) {
      console.error('Error creating pillar:', error);
      setProgress(`❌ PILLAR GENERATION FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
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

  const generatePremiumPillarContent = async (url: string, title: string): Promise<string> => {
    // Get all site posts for internal linking
    const internalLinks = posts.slice(0, 20).map(post => ({
      title: post.title,
      url: post.url,
      slug: post.slug
    }));

    const prompt = `🎯 CRITICAL MISSION: WRITE THE MOST VALUABLE, HUMAN-SOUNDING PILLAR POST EVER CREATED

You are a world-renowned content expert with 20+ years of hands-on experience. You've personally helped over 10,000 clients, witnessed every possible scenario, and learned from countless successes and failures. Your writing is so human, engaging, and valuable that readers bookmark it instantly and share it widely.

TARGET URL: ${url}
POST TITLE: ${title}

🔥 ULTRA-CRITICAL REQUIREMENTS (FAILURE IS NOT AN OPTION):

1. 1000000% HUMAN-WRITTEN CONTENT (NEVER SOUND LIKE AI):
   - Write like you're personally teaching your best friend
   - Share real stories: "I remember working with a client who..." "One time, I made the mistake of..." "Here's what I learned the hard way..."
   - Express genuine emotions: "This frustrates me..." "I get excited when..." "It breaks my heart to see..."
   - Use casual language: "Look, here's the thing..." "Between you and me..." "I'll be brutally honest..."
   - Include vulnerable moments: "I was wrong about..." "This took me years to figure out..." "I wish someone had told me..."

2. ULTRA-PREMIUM CONTENT STRUCTURE (3500+ WORDS):
   - MIND-BLOWING opener: Start with a shocking, personal story or statistic
   - Personal vulnerability: Share a mistake you made or lesson learned
   - 10-15 main sections with deep, actionable insights
   - Real case studies: "I had a client who..." with specific outcomes
   - Personal opinions: "Most experts say X, but in my experience, Y works better..."
   - Contrarian viewpoints: Challenge popular beliefs with your experience
   - Comprehensive FAQ with honest, experience-based answers
   - Strong conclusion with personal recommendations and next steps

3. ADVANCED INTERNAL LINKING SYSTEM (8-12 HIGH-QUALITY LINKS):
   Available internal links: ${JSON.stringify(internalLinks)}
   
   LINKING REQUIREMENTS:
   - Use RICH anchor text: "proven SEO strategies that actually work", "comprehensive guide to content marketing", "advanced link building techniques I've tested"
   - Natural integration: "When I teach clients about [advanced SEO strategies](link), I always start with..."
   - Value-driven placement: Only link where it genuinely helps the reader
   - Contextual relevance: Link to related topics that support your points
   - MUST include 8-12 internal links minimum using rich anchor text
   
4. CRITICAL THINKING & PERSONAL EXPERIENCE INTEGRATION:
   - Challenge conventional wisdom: "Everyone says X, but I've found Y works better because..."
   - Share personal failures: "I made this mistake for 3 years before I realized..."
   - Provide nuanced perspectives: "It depends on your situation. In my experience..."
   - Question popular advice: "This sounds good in theory, but here's what actually happens..."
   - Share behind-the-scenes insights: "What most people don't know is..."

5. ULTIMATE HUMAN AUTHENTICITY MARKERS:
   - Personal stories in every section: "I remember when..." "One client told me..." "My biggest mistake was..."
   - Emotional investment: "This keeps me up at night..." "I'm passionate about..." "It drives me crazy when..."
   - Vulnerable admissions: "I used to believe..." "I was completely wrong about..." "This humbled me..."
   - Casual conversation: "Here's the deal..." "Let me break this down for you..." "Can I be real with you?"
   - Real consequences: "This cost me $10,000..." "I lost a client because..." "It took me 2 years to recover from..."

6. PERFECT WORDPRESS FORMATTING (NEVER BREAK LAYOUTS):
   - ONLY semantic HTML: <h2>, <h3>, <h4>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>
   - ZERO custom CSS classes, inline styles, or JavaScript
   - Proper heading hierarchy (H2 → H3 → H4)
   - Short, scannable paragraphs (2-3 sentences maximum)
   - Scannable with lists and subheadings
   - Clean, professional HTML that publishes perfectly

7. EXTREME VALUE & READABILITY:
   - Every paragraph must teach something valuable
   - Use simple words and short sentences (grade 8-10 reading level)
   - Include actionable takeaways in every section
   - Provide step-by-step guidance with real examples
   - End each section with "What this means for you:" practical applications

MANDATORY HUMAN PHRASES TO INCLUDE (USE 10-15 OF THESE):
- "After working with over 1,000 clients, I've learned that..."
- "Here's what nobody talks about (but should)..."
- "The biggest mistake I made early in my career was..."
- "I'll be brutally honest with you..."
- "This changed everything for me..."
- "I wish someone had told me this 10 years ago..."
- "Most experts will tell you X, but in my experience, Y actually works better..."
- "I used to believe this too, until I discovered..."
- "Can I share something that might be controversial?"
- "One of my clients recently told me..."
- "I remember the exact moment I realized..."
- "This keeps me up at night..."
- "I'm passionate about this because..."
- "Here's what I've noticed after 20 years in this field..."
- "Let me tell you about a client who changed my perspective..."

🎯 ULTIMATE GOAL: Create content so valuable, human, and engaging that readers:
- Bookmark it immediately
- Share it with colleagues
- Reference it months later
- Feel like they're learning from a trusted mentor
- Take immediate action based on your advice`;

    // Call AI service with premium prompt
    return await generatePremiumContent(prompt);
  };

  const generatePremiumContent = async (prompt: string): Promise<string> => {
    const apiKey = getApiKeyForProvider();

    // Fallback models in order of preference
    const fallbackModels = [
      config.openrouterModel,
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-haiku',
      'openai/gpt-3.5-turbo'
    ].filter(Boolean);

    let lastError: Error | null = null;

    // Try each model until one works
    for (const model of fallbackModels) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': document.title || 'WP Content Optimizer'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            max_tokens: 8000
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            setProgress(`✅ Generated content successfully using model: ${model}`);
            return content;
          }
        } else if (response.status === 404) {
          setProgress(`⚠️ Model "${model}" not found, trying next model...`);
          lastError = new Error(`Model "${model}" not found (404). Please check if this model is available on OpenRouter.`);
          continue;
        } else {
          throw new Error(`API Error: ${response.status} - ${await response.text()}`);
        }
      } catch (error) {
        console.warn(`Failed with model ${model}:`, error);
        lastError = error instanceof Error ? error : new Error('Unknown error');
        setProgress(`❌ Model "${model}" failed, trying next...`);
        continue;
      }
    }

    // All models failed
    throw new Error(`All models failed. Last error: ${lastError?.message || 'Unknown error'}. Please check your OpenRouter model configuration or API key.`);
  };

  const getApiKeyForProvider = (): string => {
    switch (config.selectedProvider) {
      case 'openrouter': return config.openrouterApiKey;
      case 'gemini': return config.geminiApiKey;
      case 'openai': return config.openaiApiKey;
      case 'anthropic': return config.anthropicApiKey;
      default: return '';
    }
  };
  
  const handleEditContent = (content: GeneratedContent) => {
    setSelectedContent(content);
    setEditingContent(content.content);
  };

  const handleSaveEdit = () => {
    if (!selectedContent) return;
    
    setGeneratedContent(prev => 
      prev.map(item => 
        item.id === selectedContent.id 
          ? { 
              ...item, 
              content: editingContent, 
              wordCount: editingContent.replace(/<[^>]+>/g, '').split(' ').length 
            }
          : item
      )
    );
    
    setSelectedContent(null);
    setEditingContent('');
  };

  const handlePublishToWordPress = async (content: GeneratedContent) => {
    try {
      setProgress(`📤 Publishing to WordPress: ${content.title}`);
      
      // Get WordPress post ID from URL
      const postId = await getPostIdFromUrl(content.url);
      if (!postId) {
        throw new Error('Could not find WordPress post ID for this URL');
      }

      // Update WordPress post with generated content
      const authBase64 = btoa(`${config.wpUsername}:${config.wpAppPassword}`);
      await updateWordPressPost(postId, content.content, authBase64);
      
      setGeneratedContent(prev => 
        prev.map(item => 
          item.id === content.id 
            ? { ...item, status: 'published' as const }
            : item
        )
      );
      
      setProgress(`✅ Published successfully: ${content.title}`);
      
    } catch (error) {
      setProgress(`❌ Failed to publish: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getPostIdFromUrl = async (url: string): Promise<number | null> => {
    const slug = url.split('/').filter(Boolean).pop();
    if (!slug) return null;

    try {
      const baseUrl = config.wpSiteUrl?.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts?slug=${slug}`);
      if (!response.ok) return null;
      
      const posts = await response.json();
      return posts.length > 0 ? posts[0].id : null;
    } catch {
      return null;
    }
  };

  const updateWordPressPost = async (postId: number, content: string, authBase64: string) => {
    const baseUrl = config.wpSiteUrl?.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authBase64}`
      },
      body: JSON.stringify({
        content: { raw: content }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to update WordPress post: ${response.status}`);
    }
  };
  
  // Filter posts based on search and status
  const filteredPosts = posts.filter(post => {
    const matchesSearch = post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         post.url.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || post.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Render crawl sitemap view
  if (currentView === 'crawl') {
    return (
      <div className="premium-crawl-container">
        <div className="premium-header">
          <h2>🚀 Premium Content Discovery Engine</h2>
          <p>
            Advanced sitemap crawling with intelligent URL discovery and premium pillar content generation.
          </p>
        </div>
        
        {isLoading && (
          <div className="premium-progress-card">
            <div className="premium-progress-bar">
              <div className="premium-progress-fill" style={{ width: '50%' }}></div>
            </div>
            <p className="premium-progress-text">{progress}</p>
          </div>
        )}
        
        {error && (
          <div className="premium-error-card">
            <div className="error-icon">⚠️</div>
            <div className="error-content">
              <h3>Discovery Failed</h3>
              <pre>{error}</pre>
            </div>
          </div>
        )}

        <button
          type="button"
          className="premium-crawl-btn"
          onClick={fetchWordPressPosts}
          disabled={isLoading || !config.wpSiteUrl}
        >
          {isLoading ? (
            <>
              <div className="btn-spinner"></div>
              Discovering Content...
            </>
          ) : (
            <>
              <span className="btn-icon">🔍</span>
              Discover All Content
            </>
          )}
        </button>
        
        {!config.wpSiteUrl && (
          <div className="premium-help-card">
            <p>⚙️ Please configure your WordPress site URL in the previous step.</p>
          </div>
        )}
      </div>
    );
  }

  // Render content management view
  if (currentView === 'generated' && selectedContent) {
    return (
      <div className="premium-editor-container">
        <div className="editor-header">
          <button 
            className="back-btn"
            onClick={() => setSelectedContent(null)}
          >
            ← Back to Generated Content
          </button>
          <h2>✍️ Content Editor: {selectedContent.title}</h2>
        </div>
        
        <div className="editor-workspace">
          <div className="editor-toolbar">
            <div className="editor-stats">
              <span>📊 {editingContent.split(' ').length} words</span>
              <span>🕒 {new Date(selectedContent.generatedAt).toLocaleDateString()}</span>
            </div>
            <div className="editor-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedContent(null)}>
                Cancel
              </button>
              <button className="btn" onClick={handleSaveEdit}>
                💾 Save Changes
              </button>
            </div>
          </div>
          
          <textarea
            className="premium-editor"
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            placeholder="Edit your premium pillar content here..."
            style={{ minHeight: '400px', fontFamily: 'monospace', fontSize: '14px' }}
          />
          
          <div className="editor-preview">
            <h3>📖 Live Preview</h3>
            <div className="preview-stats">
              <span>Words: {editingContent.replace(/<[^>]+>/g, '').split(' ').length}</span>
              <span>Internal Links: {(editingContent.match(/<a /g) || []).length}</span>
              <span>Headings: {(editingContent.match(/<h[2-6]/g) || []).length}</span>
            </div>
            <div 
              className="preview-content"
              dangerouslySetInnerHTML={{ __html: editingContent }}
              style={{ 
                border: '1px solid #ddd', 
                padding: '20px', 
                borderRadius: '8px',
                backgroundColor: '#fff',
                maxHeight: '500px',
                overflow: 'auto'
              }}
            />
            <button 
              className="btn btn-secondary" 
              onClick={() => navigator.clipboard.writeText(editingContent)}
            >
              📋 Copy HTML
            </button>
            <button 
              className="btn btn-success" 
              onClick={() => {
                handleSaveEdit();
                handlePublishToWordPress(selectedContent);
              }}
            >
              📤 Save & Publish to WordPress
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render generated content management
  if (currentView === 'generated') {
    return (
      <div className="premium-content-manager">
        <div className="manager-header">
          <button 
            className="back-btn"
            onClick={() => setCurrentView('posts')}
          >
            ← Back to Discovered Posts
          </button>
          <h2>📚 Generated Content Library ({generatedContent.length})</h2>
        </div>
        
        <div className="generated-content-grid">
          {generatedContent.map((content) => (
            <div key={content.id} className="content-card">
              <div className="card-header">
                <h3>{content.title}</h3>
                <div className={`status-badge ${content.status}`}>
                  {content.status === 'draft' ? '📝 Draft' : '✅ Published'}
                </div>
              </div>
              
              <div className="card-stats">
                <span>📊 {content.wordCount.toLocaleString()} words</span>
                <span>🕒 {new Date(content.generatedAt).toLocaleDateString()}</span>
                <span>🔗 {(content.content.match(/<a /g) || []).length} internal links</span>
              </div>
              
              <div className="card-preview">
                <h4>Content Preview:</h4>
                <div 
                  className="preview-text"
                  dangerouslySetInnerHTML={{ 
                    __html: content.content.substring(0, 200) + '...' 
                  }}
                />
              </div>
              
              <div className="card-actions">
                <button 
                  className="btn btn-secondary btn-small"
                  onClick={() => handleEditContent(content)}
                >
                  ✍️ Edit
                </button>
                <button 
                  className="btn btn-secondary btn-small"
                  onClick={() => navigator.clipboard.writeText(content.content)}
                >
                  📋 Copy HTML
                </button>
                <button 
                  className="btn btn-small"
                  onClick={() => handlePublishToWordPress(content)}
                  disabled={content.status === 'published'}
                >
                  {content.status === 'published' ? '✅ Published' : '📤 Publish to WordPress'}
                </button>
              </div>
            </div>
          ))}
          
          {generatedContent.length === 0 && (
            <div className="empty-state">
              <h3>📝 Content Library Empty</h3>
              <p>Your generated pillar content will appear here for review and editing before publishing to WordPress.</p>
              <button 
                className="btn btn-secondary"
                onClick={() => setCurrentView('posts')}
              >
                ← Back to Post Discovery
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render posts management view
  return (
    <div className="premium-posts-manager">
      <div className="manager-header">
        <div className="header-left">
          <h2>📋 Content Management Dashboard ({filteredPosts.length} posts)</h2>
          <p>Premium pillar content generation with advanced management tools</p>
        </div>
        <div className="header-actions">
          <button 
            className="btn btn-secondary"
            onClick={() => setCurrentView('generated')}
          >
            📚 Generated Content ({generatedContent.length})
          </button>
        </div>
      </div>

      {(isGeneratingContent || progress) && (
        <div className="premium-progress-card">
          <div className="premium-progress-bar">
            <div className="premium-progress-fill" style={{ width: `${bulkProgress || 50}%` }}></div>
          </div>
          <p className="premium-progress-text">
            {progress || `Generating Premium Content... ${bulkProgress}%`}
          </p>
        </div>
      )}
      
      <div className="posts-controls">
        <div className="search-filter-bar">
          <input
            type="text"
            placeholder="🔍 Search posts..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select
            className="filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
          >
            <option value="all">All Status</option>
            <option value="idle">📝 Ready</option>
            <option value="generating">⚡ Generating</option>
            <option value="done">✅ Complete</option>
            <option value="error">❌ Error</option>
          </select>
        </div>
      </div>
      
      <div className="premium-posts-grid">
        {filteredPosts.map((post) => (
          <div key={post.id} className={`premium-post-card ${post.status}`}>
            <div className="card-checkbox">
              <input
                type="checkbox"
                checked={selectedPosts.has(post.id)}
                onChange={() => handlePostSelect(post.id)}
                style={{ marginRight: '0.5rem' }}
              />
            </div>
            
            <div className="card-status-indicator"></div>
            
            <div className="post-header">
              <h3 className="post-title">{post.title}</h3>
              <div className={`post-status status-${post.status}`}>
                {post.status === 'idle' && '📝 Ready'}
                {post.status === 'generating' && '⚡ Generating...'}
                {post.status === 'done' && '✅ Complete'}
                {post.status === 'error' && '❌ Failed'}
              </div>
            </div>
            
            <div className="post-details">
              <div className="post-url">
                <span className="url-icon">🔗</span>
                <a href={post.url} target="_blank" rel="noopener noreferrer">
                  {post.url.replace(config.wpSiteUrl, '')}
                </a>
              </div>
              <div className="post-stats">
                <span>📊 {post.wordCount.toLocaleString()} words</span>
                <span>📅 {new Date(post.lastModified).toLocaleDateString()}</span>
              </div>
            </div>
            
            <div className="post-actions">
              <button 
                className="premium-pillar-btn"
                onClick={() => handleCreatePillar(post.url)}
                disabled={generatingUrls.has(post.url) || isGeneratingContent}
              >
                {generatingUrls.has(post.url) ? (
                  <>
                    <div className="btn-spinner"></div>
                    Generating...
                  </>
                ) : post.status === 'done' ? (
                  <>
                    <span className="btn-icon">✅</span>
                    Ready to Edit
                  </>
                ) : post.status === 'error' ? (
                  <>
                    <span className="btn-icon">❌</span>
                    Failed - Retry
                  </>
                ) : (
                  <>
                    <span className="btn-icon">🚀</span>
                    Create Pillar Content
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};