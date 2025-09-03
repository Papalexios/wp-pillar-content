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
        content: 'You are a world-class content strategist and domain expert with 20+ years of experience creating viral, engaging content. Your articles consistently rank #1 on Google, have 90%+ engagement rates, and are cited by industry leaders. You excel at transforming complex topics into compelling, easy-to-understand content that delivers massive value to readers.'
      },
      {
        role: 'developer',
        content: `CRITICAL REQUIREMENTS - MUST FOLLOW ALL:

        CONTENT QUALITY & LENGTH:
        - Minimum 2000 words (aim for 2500-3500 words)
        - 10x higher quality than any competing content
        - Grade 8-10 readability (use Hemingway Editor principles)
        - Short paragraphs (2-3 sentences max)
        - Scannable with clear subheadings every 200-300 words

        INTRODUCTION REQUIREMENTS:
        - Start with a jaw-dropping, fact-checked statistic that shocks readers
        - Use storytelling elements to create emotional connection
        - Promise specific, actionable outcomes the reader will achieve
        - Include a compelling hook that makes scrolling irresistible

        SEMANTIC KEYWORD INTEGRATION:
        - Naturally weave semantic keywords throughout (LSI keywords, synonyms, related terms)
        - Use topic clusters and semantic relationships
        - Include industry-specific terminology and jargon appropriately
        - Maintain keyword density of 1-2% for primary keywords

        PEOPLE ALSO ASK (PAA) INTEGRATION:
        - Research and include 8-12 People Also Ask questions for the topic
        - Answer each PAA question comprehensively within the content
        - Format as dedicated FAQ section AND weave answers throughout
        - Use question-based subheadings where natural

        STRUCTURE & E-E-A-T:
        1. Compelling headline with power words
        2. Shocking statistic + engaging introduction (300+ words)
        3. Table of contents for long-form content
        4. 7-12 main sections with actionable insights
        5. Real examples, case studies, and first-hand experience
        6. Comprehensive FAQ section (People Also Ask)
        7. Expert quotes and credible sources
        8. Pros/cons analysis with balanced perspective
        9. Step-by-step tutorials with screenshots/examples
        10. Strong conclusion with clear next steps

        ENGAGEMENT & READABILITY:
        - Use power words and emotional triggers
        - Include numbered/bulleted lists frequently
        - Add "Pro Tips," "Warning," and "Expert Insight" callout boxes
        - Use transition phrases between sections
        - Include relevant analogies and metaphors
        - End each section with a takeaway or action item`
      },
      {
        role: 'user',
        content: `CONTENT UPGRADE MISSION:

URL: ${url}
Original Title: ${existingContent.title}
Current Content Preview: """${existingContent.excerpt}"""

MISSION: Transform this into the DEFINITIVE, most comprehensive resource on this topic that:

1. SHOCKING OPENER: Start with a mind-blowing, fact-checked statistic that makes readers think "I had no idea!"

2. SEMANTIC MASTERY: Strategically incorporate ALL related semantic keywords, synonyms, and LSI terms naturally throughout the content

3. PAA DOMINATION: Research and answer these People Also Ask questions within the content:
   - What is [main topic] and why does it matter?
   - How do beginners get started with [topic]?
   - What are the most common mistakes with [topic]?
   - How long does it take to see results from [topic]?
   - What tools/resources are needed for [topic]?
   - How much does [topic] cost?
   - Is [topic] worth it for [specific audience]?
   - What are alternatives to [topic]?

4. AUTHORITY BUILDING: Include expert quotes, studies, and credible sources

5. EXPERIENCE SIGNALS: Add first-person insights, lessons learned, and real examples

6. COMPREHENSIVE COVERAGE: Cover every angle competitors miss, go 3x deeper than existing content

7. ACTIONABLE VALUE: Every section must include specific, implementable advice

CONTENT REQUIREMENTS:
- Minimum 2000 words, targeting 2500-3500 words
- Grade 8-10 readability with short paragraphs
- Scannable format with clear subheadings
- FAQ section answering People Also Ask questions
- Expert-level insights with balanced analysis
- Strong E-E-A-T signals throughout

Return only the complete HTML content for the post body (no meta tags, titles, or WordPress-specific markup).`
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
    return `PILLAR PAGE CONTENT GENERATION - ULTRA HIGH QUALITY:

Target: ${pillarPage.title}

MISSION: Create the most comprehensive, authoritative pillar page that becomes the definitive resource for this topic.

CRITICAL REQUIREMENTS:

1. SHOCKING INTRODUCTION:
   - Start with a jaw-dropping, fact-checked statistic
   - Use storytelling to create emotional connection
   - Promise specific outcomes readers will achieve

2. COMPREHENSIVE LENGTH: 2500-4000 words minimum

3. SEMANTIC KEYWORD MASTERY:
   - Research and include ALL semantic keywords for this topic
   - Use LSI keywords naturally throughout
   - Include topic clusters and related terms
   - Maintain 1-2% keyword density for primary terms

4. PEOPLE ALSO ASK INTEGRATION:
   Research and answer these PAA questions:
   - What is [topic] and why is it important?
   - How do you get started with [topic]?
   - What are the benefits of [topic]?
   - What are common mistakes to avoid with [topic]?
   - How long does [topic] take to master?
   - What tools are needed for [topic]?
   - How much does [topic] cost?
   - What are alternatives to [topic]?
   - Is [topic] right for beginners?
   - How do you measure success with [topic]?

5. STRUCTURE & E-E-A-T:
   - Compelling introduction with shocking statistic (400+ words)
   - Table of contents
   - 8-15 main sections with deep insights
   - Real examples and case studies
   - Expert quotes and credible sources
   - Comprehensive FAQ section
   - Step-by-step tutorials
   - Pros/cons analysis
   - Strong conclusion with next steps

6. READABILITY:
   - Grade 8-10 reading level
   - Short paragraphs (2-3 sentences)
   - Numbered and bulleted lists
   - Clear subheadings every 200-300 words
   - Transition phrases between sections

7. ENGAGEMENT ELEMENTS:
   - "Pro Tips" and "Expert Insights" callouts
   - Warning boxes for common mistakes
   - Action items at end of each section
   - Internal linking opportunities marked

Return complete HTML content that will dominate search results and provide massive value to readers.`;
  };

  const createClusterArticlePrompt = (article: any, pillarPage: any, options: GenerationOptions): string => {
    return `CLUSTER ARTICLE GENERATION - PREMIUM QUALITY:

Article: ${article.title}
Supporting Pillar: ${pillarPage.title}
Target Keywords: ${article.keywords ? article.keywords.join(', ') : 'Not specified'}

MISSION: Create a comprehensive supporting article that perfectly complements the pillar page.

CRITICAL REQUIREMENTS:

1. ENGAGING OPENER:
   - Start with a surprising, fact-checked statistic
   - Connect to the pillar page topic naturally
   - Promise specific value readers will gain

2. OPTIMAL LENGTH: 1500-2500 words

3. SEMANTIC KEYWORD STRATEGY:
   - Focus on long-tail variations of pillar keywords
   - Include semantic keywords and LSI terms
   - Use related terminology strategically
   - Reference pillar page topic naturally

4. PEOPLE ALSO ASK COVERAGE:
   Answer relevant PAA questions for this specific subtopic:
   - How does [article topic] relate to [pillar topic]?
   - What are the best practices for [article topic]?
   - What mistakes should you avoid with [article topic]?
   - How do you implement [article topic] effectively?
   - When should you use [article topic]?
   - What tools help with [article topic]?

5. SUPPORTING STRUCTURE:
   - Clear introduction linking to pillar concept
   - 5-8 main sections with deep dives
   - Practical examples and case studies
   - Expert insights and quotes
   - FAQ section for subtopic
   - Clear internal linking opportunities to pillar page

6. E-E-A-T SIGNALS:
   - First-hand experience and insights
   - Expert authority establishment
   - Balanced analysis with pros/cons
   - Credible sources and citations

7. READABILITY:
   - Grade 8-10 reading level
   - Scannable format with subheadings
   - Short paragraphs and clear transitions
   - Actionable takeaways in each section

Return complete HTML content optimized for search rankings and reader engagement.`;
  };

  const createPostUpdatePrompt = (postId: number, options: GenerationOptions): string => {
    return `Update and optimize content for post ID: ${postId}`;
  };

  const callOpenRouter = async (apiKey: string, model: string, messages: any[], retryCount = 0): Promise<string> => {
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
    } catch (error) {
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`Network error. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callOpenRouter(apiKey, model, messages, retryCount + 1);
      }
      throw error;
    }
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