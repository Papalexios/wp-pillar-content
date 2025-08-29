import { useState } from 'react';
import { ContentCluster, ContentBrief, EEATSignals, SchemaType } from '../types';

interface GenerationOptions {
  includeInternalLinks?: boolean;
  enableEEAT?: boolean;
  generateDiverseSchema?: boolean;
  autoInternalLinking?: boolean;
  diverseSchema?: boolean;
  eeatSignals?: boolean;
  competitorAnalysis?: boolean;
}

export const useContentGeneration = (config: any) => {
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [bulkProgress, setBulkProgress] = useState(0);

  const generateClusterContent = async (
    cluster: ContentCluster,
    options: GenerationOptions = {}
  ) => {
    setIsGeneratingContent(true);
    setProgress(0);

    try {
      // Generate pillar page content
      setProgress(20);
      await generatePillarContent(cluster.pillarPage, options);

      // Generate cluster articles with internal linking
      for (let i = 0; i < cluster.clusterArticles.length; i++) {
        setProgress(20 + ((i + 1) / cluster.clusterArticles.length) * 60);
        await generateClusterArticle(cluster.clusterArticles[i], cluster.pillarPage, options);
      }

      // Auto-generate internal links if enabled
      if (options.autoInternalLinking) {
        setProgress(85);
        await generateInternalLinks(cluster);
      }

      setProgress(100);
      
    } catch (error) {
      console.error('Error generating cluster content:', error);
      throw error;
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const generateSingleArticle = async (articleData: {
    title: string;
    targetKeyword: string;
    metaDescription: string;
    contentBrief: string;
    schemaType: SchemaType['type'];
    eeatSignals?: boolean;
    competitorAnalysis?: boolean;
  }) => {
    setIsGeneratingContent(true);
    setProgress(0);

    try {
      setProgress(10);
      
      // Step 1: Competitive analysis if enabled
      let competitorInsights = '';
      if (articleData.competitorAnalysis) {
        setProgress(30);
        competitorInsights = await perform10xAnalysis(articleData.targetKeyword);
      }

      // Step 2: Generate enhanced content brief
      setProgress(50);
      const enhancedBrief = await createEnhancedContentBrief(
        articleData,
        competitorInsights,
        articleData.eeatSignals
      );

      // Step 3: Generate the actual content
      setProgress(70);
      const generatedContent = await generateContentFromBrief(enhancedBrief, articleData.schemaType);

      // Step 4: Generate appropriate schema markup
      setProgress(90);
      const schema = await generateSchemaMarkup(articleData.schemaType, generatedContent);

      setProgress(100);

      // Return or save the generated content
      console.log('Generated content:', {
        content: generatedContent,
        schema,
        brief: enhancedBrief
      });

    } catch (error) {
      console.error('Error generating single article:', error);
      throw error;
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const generateBulkContent = async (urlsToProcess: string[], options: GenerationOptions = {}) => {
    setIsGeneratingContent(true);
    setBulkProgress(0);

    const authBase64 = btoa(`${config.wpUsername}:${config.wpAppPassword}`);

    try {
      await generateAndUpdatePosts(urlsToProcess, {
        apiKey: getApiKeyForProvider(),
        model: config.openrouterModel || 'anthropic/claude-3.5-sonnet',
        authBase64,
        provider: config.selectedProvider
      });
    } catch (error) {
      console.error('Error in bulk content generation:', error);
      throw error;
    } finally {
      setIsGeneratingContent(false);
      setBulkProgress(0);
    }
  };

  const generateAndUpdatePosts = async (urls: string[], cfg: {
    apiKey: string; 
    model: string; 
    authBase64: string;
    provider: string;
  }) => {
    const concurrency = 2;
    const batches = [];
    
    for (let i = 0; i < urls.length; i += concurrency) {
      batches.push(urls.slice(i, i + concurrency));
    }

    let completed = 0;
    
    for (const batch of batches) {
      await Promise.all(
        batch.map(async (url) => {
          try {
            await processOneUrl(url, cfg);
            completed++;
            setBulkProgress((completed / urls.length) * 100);
          } catch (error) {
            console.error(`Failed to process ${url}:`, error);
            // Retry logic could go here
          }
        })
      );
    }
  };

  const processOneUrl = async (url: string, cfg: {
    apiKey: string; 
    model: string; 
    authBase64: string;
    provider: string;
  }) => {
    // Step 1: Extract slug from URL
    const slug = slugFromUrl(url);
    
    // Step 2: Get post ID from WordPress
    const postId = await getPostIdBySlug(slug);
    if (!postId) {
      throw new Error(`No post found for slug: ${slug}`);
    }

    // Step 3: Fetch existing content for grounding
    const existingContent = await fetchExistingPost(postId);
    
    // Step 4: Generate new content with premium E-E-A-T prompt
    const generatedContent = await generatePremiumContent(url, existingContent, cfg);
    
    // Step 5: Update WordPress post
    return await updateWpPost({
      id: postId,
      content: generatedContent,
      authBase64: cfg.authBase64
    });
  };

  const slugFromUrl = (url: string): string => {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').filter(Boolean).pop() || '';
    } catch {
      return '';
    }
  };

  const getPostIdBySlug = async (slug: string): Promise<number | null> => {
    try {
      // Try posts first
      let res = await fetch(`/wp-api-proxy/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const posts = await res.json();
        if (Array.isArray(posts) && posts.length > 0 && posts[0].id) {
          return posts[0].id;
        }
      }
      
      // Try pages if no post found
      res = await fetch(`/wp-api-proxy/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const pages = await res.json();
        if (Array.isArray(pages) && pages.length > 0 && pages[0].id) {
          return pages[0].id;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error looking up post ID for slug ${slug}:`, error);
      return null;
    }
  };

  const fetchExistingPost = async (postId: number) => {
    try {
      const res = await fetch(`/wp-api-proxy/wp-json/wp/v2/posts/${postId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch post ${postId}: ${res.status}`);
      }
      const post = await res.json();
      return {
        title: post.title?.rendered || '',
        content: post.content?.rendered || '',
        excerpt: post.content?.rendered?.replace(/<[^>]+>/g, '').slice(0, 2000) || ''
      };
    } catch (error) {
      console.error(`Error fetching existing post ${postId}:`, error);
      return { title: '', content: '', excerpt: '' };
    }
  };

  const generatePremiumContent = async (url: string, existingContent: any, cfg: any): Promise<string> => {
    const messages = [
      {
        role: 'system',
        content: 'Act as a senior domain expert and editor producing reader-first articles that meet Google\'s Helpful Content guidelines and E-E-A-T, with clear structure, factual accuracy, and first-hand experience where appropriate.'
      },
      {
        role: 'developer',
        content: 'Requirements: 1) Title + TL;DR, 2) Intro with first-person experience or perspective, 3) 5–9 Key Insights with examples, 4) How-to steps with caveats, 5) Pros/Cons, 6) Case study or scenario, 7) FAQs, 8) Sources and attributions, 9) Conclusion with a clear stance, 10) Reading ease ~8th–10th grade, short paragraphs, scannable headings.'
      },
      {
        role: 'user',
        content: `URL: ${url}
Original Title: ${existingContent.title}
Existing Content Excerpt: """${existingContent.excerpt}"""

Task: Completely rewrite and upgrade this content to premium quality with:
- First-hand experience and insights
- Critical analysis and balanced perspective
- Comprehensive coverage that outperforms competitors
- Perfect structure for readability and SEO
- Strong E-E-A-T signals throughout

Return only the HTML content for the post body (no meta tags or titles).`
      }
    ];

    return await callAIService(messages, cfg);
  };

  const updateWpPost = async ({
    id,
    content,
    title,
    status = 'publish',
    authBase64
  }: {
    id: number;
    content: string;
    title?: string;
    status?: 'publish' | 'draft';
    authBase64: string;
  }) => {
    const updateData: any = { content: { raw: content } };
    if (title) {
      updateData.title = title;
    }
    if (status) {
      updateData.status = status;
    }

    const res = await fetch(`/wp-api-proxy/wp-json/wp/v2/posts/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authBase64}`
      },
      body: JSON.stringify(updateData)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`WordPress update failed ${res.status}: ${errorText}`);
    }

    return res.json();
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

  const callAIService = async (messages: any[], cfg: any): Promise<string> => {
    switch (cfg.provider) {
      case 'openrouter':
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': document.title || 'WP Content Optimizer'
          },
          body: JSON.stringify({ 
            model: cfg.model,
            messages,
            temperature: 0.7
          })
        });

        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'No response generated';
        
      default:
        // For other providers, implement similar logic
        throw new Error(`Provider ${cfg.provider} not fully implemented yet`);
    }
  };

  // Remove the old mock implementations
  const generateContentForPost = async (postId: number, options: GenerationOptions) => {
    // This is now handled by generateAndUpdatePosts
    throw new Error('Use generateAndUpdatePosts instead');
  };

  // Helper functions

  const generatePillarContent = async (pillarPage: any, options: GenerationOptions) => {
    const prompt = createPillarContentPrompt(pillarPage, options);
    // Call AI service with prompt
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const generateClusterArticle = async (article: any, pillarPage: any, options: GenerationOptions) => {
    const prompt = createClusterArticlePrompt(article, pillarPage, options);
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const generateInternalLinks = async (cluster: ContentCluster) => {
    // AI prompt for contextual internal linking
    const prompt = `
      Analyze the pillar page and cluster articles content.
      Identify 2-3 contextually relevant phrases in the pillar page and insert hyperlinks to appropriate cluster articles.
      Find relevant phrases in each cluster article and link back to the pillar page.
      
      Return the updated HTML for all articles with natural, contextually appropriate internal links.
      
      Pillar Page: ${cluster.pillarPage.content}
      Cluster Articles: ${JSON.stringify(cluster.clusterArticles)}
    `;
    
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const perform10xAnalysis = async (keyword: string): Promise<string> => {
    // This would integrate with the competitor analysis hook
    const prompt = `
      Analyze the top 3 ranking articles for "${keyword}".
      Identify core topics, key arguments, and unique points each makes.
      Synthesize this information and provide insights for creating content that covers all these points 
      plus additional topics they missed.
      
      Return a comprehensive content brief for superior content.
    `;
    
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const createEnhancedContentBrief = async (
    articleData: any,
    competitorInsights: string,
    includeEEAT: boolean = false
  ): Promise<ContentBrief> => {
    const eeatPrompt = includeEEAT ? `
      Include E-E-A-T optimization:
      - Authoritativeness: Incorporate expert quotes and cite reputable sources
      - Experience: Include first-person insights and personal anecdotes  
      - Trust: Add balanced pros/cons analysis
    ` : '';

    const prompt = `
      Create an enhanced content brief for: "${articleData.title}"
      Target Keyword: ${articleData.targetKeyword}
      Original Brief: ${articleData.contentBrief}
      
      ${competitorInsights ? `Competitor Insights: ${competitorInsights}` : ''}
      
      ${eeatPrompt}
      
      Generate a comprehensive brief that will result in content superior to existing competition.
    `;

    const result = await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
    
    // Parse and structure the response
    return {
      title: articleData.title,
      outline: [], // Parse from AI response
      competitorGaps: [], // Parse from AI response  
      eeatRequirements: {} as EEATSignals, // Parse from AI response
      schemaType: { type: articleData.schemaType, data: {} },
      targetKeywords: [articleData.targetKeyword]
    };
  };

  const generateContentFromBrief = async (brief: ContentBrief, schemaType: SchemaType['type']) => {
    const prompt = `
      Based on this comprehensive brief, generate high-quality, SEO-optimized content:
      ${JSON.stringify(brief)}
      
      Requirements:
      - Follow the outline structure
      - Address all competitor gaps identified
      - Include E-E-A-T signals where specified
      - Optimize for target keywords naturally
      - Structure for ${schemaType} schema markup
      
      Generate complete, publish-ready HTML content.
    `;
    
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const generateSchemaMarkup = async (schemaType: SchemaType['type'], content: string) => {
    const prompt = `
      Generate appropriate ${schemaType} schema markup for this content:
      ${content}
      
      Return valid JSON-LD schema that enhances search visibility and rich snippet opportunities.
    `;
    
    return await callAIService([{ role: 'user', content: prompt }], { provider: config.selectedProvider, apiKey: getApiKeyForProvider(), model: config.openrouterModel || 'anthropic/claude-3.5-sonnet' });
  };

  const createPillarContentPrompt = (pillarPage: any, options: GenerationOptions): string => {
    return `Generate comprehensive pillar page content for: ${pillarPage.title}`;
  };

  const createClusterArticlePrompt = (article: any, pillarPage: any, options: GenerationOptions): string => {
    return `Generate cluster article: ${article.title} that supports pillar page: ${pillarPage.title}`;
  };

  const createPostUpdatePrompt = (postId: number, options: GenerationOptions): string => {
    return `Update and optimize content for post ID: ${postId}`;
  };

  const callOpenRouter = async (apiKey: string, model: string, messages: any[], retryCount = 0): Promise<string> => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': document.title || 'WP Content Optimizer'
      },
      body: JSON.stringify({ 
        model, 
        messages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        // Exponential backoff: 2^retryCount seconds
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`Rate limited. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callOpenRouter(apiKey, model, messages, retryCount + 1);
      }
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated';
  };

  return {
    generateClusterContent,
    generateSingleArticle,
    generateBulkContent,
    isGeneratingContent,
    progress,
    bulkProgress
  };
};