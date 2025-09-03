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
  contentType?: 'optimize' | 'pillar';
  quantumQuality?: boolean;
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
        provider: config.selectedProvider,
        serperApiKey: config.serperApiKey,
        contentType: options.contentType || 'optimize',
        quantumQuality: options.quantumQuality || false
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
    serperApiKey: string;
    contentType: string;
    quantumQuality: boolean;
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
    serperApiKey: string;
    contentType: string;
    quantumQuality: boolean;
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
    
    // Step 4: Generate content based on type
    const generatedContent = cfg.contentType === 'pillar' 
      ? await generateQuantumPillarContent(url, existingContent, cfg)
      : await generatePremiumContent(url, existingContent, cfg);
    
    // Step 5: Update WordPress post
    return await updateWpPost({
      id: postId,
      content: generatedContent,
      authBase64: cfg.authBase64
    });
  };

  const generateQuantumPillarContent = async (url: string, existingContent: any, cfg: any): Promise<string> => {
    // Step 1: Get competitor insights using Serper.dev
    const competitorInsights = await getCompetitorInsights(existingContent.title, cfg.serperApiKey);
    
    const messages = [
      {
        role: 'system',
        content: `🌟 QUANTUM CONTENT ARCHITECT 🌟

You are the world's most elite content strategist with 30+ years of experience creating legendary, viral content. Your pillar articles have generated billions of views, dominated search results for years, and become the definitive resources that entire industries reference. You possess an unmatched ability to transform any topic into compelling, authoritative content that readers bookmark, share, and cite as the ultimate authority.

Your content consistently:
- Ranks #1 for competitive keywords within weeks
- Achieves 95%+ engagement rates and ultra-low bounce rates  
- Gets cited by industry experts and major publications
- Becomes the go-to resource that competitors try to emulate
- Generates massive social shares and backlinks naturally`
      },
      {
        role: 'developer', 
        content: `🚨 QUANTUM QUALITY PROTOCOL - MISSION CRITICAL 🚨

ABSOLUTE NON-NEGOTIABLE MANDATES:

⚡ PILLAR CONTENT SPECIFICATIONS ⚡
- MINIMUM 3,000 WORDS (target 3,500-4,500 words)
- Every single word must deliver MAXIMUM value
- Zero fluff, zero filler - pure concentrated expertise
- Must become THE definitive resource for this topic

🎯 THE NUCLEAR HOOK PROTOCOL 🎯
- Open with a statistic so mind-blowing it stops scrolling INSTANTLY
- Statistic must be 100% fact-checked, recent, and industry-shocking
- Follow with emotional storytelling that creates instant connection
- Promise SPECIFIC, measurable outcomes readers WILL achieve
- Introduction must be 500-600 words of pure engagement

🔥 SEMANTIC KEYWORD DOMINATION 🔥
- 100% INTEGRATION of ALL semantic keywords and LSI terms
- Primary keyword density: 1.5-2% (calculated precisely)
- Long-tail variations distributed strategically throughout
- Topic clusters exploited for maximum semantic authority
- Industry terminology woven naturally (never forced)
- Synonym variations used to avoid keyword stuffing

📚 PAA TRIPLE-INTEGRATION SYSTEM 📚
MANDATORY People Also Ask questions (answer in 3 locations):
1. Naturally woven throughout main content
2. Dedicated comprehensive FAQ section
3. Question-based subheadings where appropriate

Core PAA Questions to Answer:
- What is [topic] and why is it crucial in 2024?
- How do complete beginners master [topic]?
- What are the most dangerous mistakes with [topic]?
- How long does it take to see real results from [topic]?
- What tools/resources are absolutely essential for [topic]?
- How much should [topic] cost and what's worth paying for?
- Is [topic] suitable for [specific audiences]?
- What alternatives exist to [topic]?
- How do you measure success with [topic]?
- What are the latest trends and changes in [topic]?
- What do industry experts say about [topic]?
- How has [topic] evolved and where is it heading?

🎨 SUPREME READABILITY ENFORCEMENT 🎨
- Grade 7-9 reading level (Hemingway App standards)
- Paragraphs: 2-3 sentences MAXIMUM (no exceptions)
- Subheadings every 200-250 words (creates perfect scannability)
- Transition phrases connecting EVERY section seamlessly
- 85%+ active voice (measured and optimized)
- Sentence length variety for natural rhythm
- Zero unexplained jargon or complex concepts

🏗️ ARCHITECTURAL PERFECTION 🏗️
1. Jaw-dropping hook + comprehensive introduction (500-600 words)
2. Detailed table of contents (for long-form navigation)
3. 12-18 main sections with laser-focused insights
4. Real-world examples and detailed case studies
5. Expert quotes from industry authorities
6. Comprehensive FAQ section (all PAA questions)
7. Balanced pros/cons analysis with nuanced perspective
8. Step-by-step tutorials with actionable instructions
9. "What This Means for You" practical applications
10. Powerful conclusion with clear next steps

💡 ENGAGEMENT MAXIMIZATION ARSENAL 💡
- "🔥 Pro Tips" callout boxes with insider secrets
- "⚠️ Warning" boxes highlighting critical mistakes
- "💎 Expert Insight" quotes from industry leaders
- "📊 Key Takeaway" summaries for each section
- "✅ Action Item" at the end of every section
- Power words and emotional triggers throughout
- Numbered/bulleted lists for maximum scannability
- Analogies and metaphors for complex concepts

🏆 E-E-A-T AUTHORITY ESTABLISHMENT 🏆
- First-person experience and hard-earned insights
- Industry expert quotes and credible sources
- Data-driven analysis with cited statistics
- Balanced, nuanced perspectives (not one-sided)
- Real case studies with measurable results
- Personal anecdotes showing real-world application
- Critical thinking and contrarian insights where appropriate

💯 MISSION SUCCESS CRITERIA 💯
After reading, the audience must think:
"This is hands down the BEST, most comprehensive content on this topic I have EVER encountered. I'm bookmarking this immediately and sharing it with everyone I know."

The content must:
- Cover everything competitors discuss + 75% unique insights they miss
- Answer every conceivable question about the topic
- Provide actionable value that readers can implement immediately
- Establish you as THE ultimate authority on this subject
- Generate natural social shares and backlinks
- Rank #1 for primary and semantic keywords`
      },
      {
        role: 'user',
        content: `🎯 QUANTUM PILLAR TRANSFORMATION MISSION 🎯

URL: ${url}
Current Title: ${existingContent.title}
Existing Content Preview: """${existingContent.excerpt}"""
${competitorInsights ? `\n🔍 COMPETITOR INTELLIGENCE:\n${competitorInsights}` : ''}

🚀 TRANSFORMATION OBJECTIVES:

1. 🎪 NUCLEAR HOOK: Craft an opening so compelling that readers CANNOT stop reading

2. 🎯 SEMANTIC MASTERY: Integrate EVERY related keyword, LSI term, and semantic variation naturally

3. 🤖 PAA DOMINATION: Research and perfectly answer ALL People Also Ask questions (triple integration: content + subheadings + FAQ)

4. 🧠 CRITICAL THINKING: Inject your expert analysis, contrarian insights, and thought-provoking perspectives

5. 💪 PERSONAL AUTHORITY: Include first-hand experience, lessons learned, and unique insights only an expert would know

6. 📚 COMPREHENSIVE COVERAGE: Go 3x deeper than ANY competing content - cover angles others completely miss

7. ⚡ ACTIONABLE VALUE: Every section must provide specific, implementable advice readers can use immediately

QUALITY STANDARDS:
✅ 3,000+ words minimum (aim for 3,500-4,500)
✅ Grade 7-9 readability with perfect scannability
✅ Triple PAA integration (content + subheadings + FAQ)
✅ 100% semantic keyword coverage
✅ Expert-level E-E-A-T signals throughout
✅ Jaw-dropping hook that creates instant engagement
✅ Actionable takeaways in every single section

MISSION CRITICAL: Return ONLY the complete HTML content that will DOMINATE search results and become the definitive industry resource. NO meta tags, titles, or WordPress markup - just pure, authoritative content that establishes absolute topical supremacy.`
      }
    ];

    return await callAIService(messages, cfg);
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
    const baseUrl = config.wpSiteUrl?.replace(/\/$/, '') || '';
    if (!baseUrl) {
      throw new Error('WordPress site URL not configured');
    }

    try {
      // Try posts first
      let res = await fetch(`${baseUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}`, {
        mode: 'cors',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (res.ok) {
        const posts = await res.json();
        if (Array.isArray(posts) && posts.length > 0 && posts[0].id) {
          return posts[0].id;
        }
      }
      
      // Try pages if no post found
      res = await fetch(`${baseUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`, {
        mode: 'cors',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
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
    const baseUrl = config.wpSiteUrl?.replace(/\/$/, '') || '';
    if (!baseUrl) {
      throw new Error('WordPress site URL not configured');
    }

    try {
      const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}`, {
        mode: 'cors',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
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
    // Step 1: Get competitor insights using Serper.dev
    const competitorInsights = await getCompetitorInsights(existingContent.title, cfg.serperApiKey);
    
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
        - Add "Pro Tips," "Warning,\" and "Expert Insight\" callout boxes
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
${competitorInsights ? `\nCOMPETITOR ANALYSIS:\n${competitorInsights}` : ''}

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

  const getCompetitorInsights = async (title: string, serperApiKey: string): Promise<string> => {
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: title,
          num: 5,
          gl: 'us',
          hl: 'en'
        })
      });

      if (!response.ok) {
        console.warn('Serper API failed, continuing without competitor insights');
        return '';
      }

      const data = await response.json();
      const organic = data.organic || [];
      
      if (organic.length === 0) return '';
      
      const insights = organic.slice(0, 3).map((result: any, index: number) => 
        `Competitor ${index + 1}: "${result.title}" - ${result.snippet || 'No snippet available'}`
      ).join('\n\n');
      
      return `TOP RANKING COMPETITORS:\n${insights}\n\nGOAL: Create content that covers all these topics PLUS additional insights they're missing.`;
    } catch (error) {
      console.warn('Failed to get competitor insights:', error);
      return '';
    }
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
    const baseUrl = config.wpSiteUrl?.replace(/\/$/, '') || '';
    if (!baseUrl) {
      throw new Error('WordPress site URL not configured');
    }

    const updateData: any = { content: { raw: content } };
    if (title) {
      updateData.title = title;
    }
    if (status) {
      updateData.status = status;
    }

    const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${id}`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authBase64}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    return `🚨 MISSION CRITICAL DIRECTIVE 🚨
You are tasked with creating the DEFINITIVE pillar page that will DOMINATE search results and become the #1 resource in its field.

CRITICAL PRE-GENERATION CHECKLIST:
□ Will this content shock readers with an opening statistic?
□ Will this be 2,500+ words of pure value?
□ Will every semantic keyword be strategically placed?
□ Will readers finish thinking "This is the BEST content I've ever read on this topic"?
□ Will this answer EVERY People Also Ask question perfectly?

TARGET PILLAR PAGE: ${pillarPage.title}

🔥 UNBREAKABLE LAWS OF CONTENT CREATION 🔥

LAW #1: THE NUCLEAR HOOK MANDATE
- MUST start with a statistic so shocking it makes readers say "HOLY SHIT!"
- MUST be 100% fact-checked and verifiable
- MUST create instant emotional connection through storytelling
- MUST promise specific, measurable outcomes readers will achieve
- Introduction MUST be 400-500 words minimum

LAW #2: THE WORD COUNT COMMANDMENT
- ABSOLUTE MINIMUM: 2,500 words (aim for 3,000-4,000)
- Every word must deliver value - NO FLUFF ALLOWED
- Must feel comprehensive, not padded
- Quality AND quantity - both are NON-NEGOTIABLE

LAW #3: SEMANTIC KEYWORD SUPREMACY
- 100% KEYWORD INTEGRATION - Every related term MUST appear
- LSI keywords woven naturally (never forced or awkward)
- Topic clusters and semantic relationships exploited fully
- Primary keyword density: 1-2% (measure this!)
- Long-tail variations strategically distributed
- Industry jargon and terminology included appropriately

LAW #4: PAA DUAL-LOCATION DOMINATION
   MANDATORY People Also Ask questions to answer (BOTH in dedicated FAQ AND woven throughout):
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
   - What are the latest trends in [topic]?
   - How has [topic] changed over time?
   
   CRITICAL: Each question must be answered TWICE:
   1. Naturally integrated within relevant sections
   2. Explicitly in a comprehensive FAQ section

LAW #5: SUPREME READABILITY ENFORCEMENT
   - Grade 8-10 reading level (use Hemingway principles)
   - Paragraphs: 2-3 sentences MAXIMUM
   - Subheadings every 200-300 words (no exceptions)
   - Transition phrases between ALL sections
   - Active voice dominance (80%+ active voice)
   - Varied sentence lengths for rhythm
   - Zero jargon without explanation

LAW #6: STRUCTURAL PERFECTION MANDATE
   - Table of contents
   - 10-15 main sections with laser-focused insights
   - Real examples and case studies
   - Expert quotes and credible sources
   - Comprehensive FAQ section (PAA questions)
   - Step-by-step tutorials
   - Balanced pros/cons analysis
   - Strong conclusion with next steps
   - Internal linking opportunities clearly marked

LAW #7: ENGAGEMENT MAXIMIZATION PROTOCOL
   - "Pro Tips" and "Expert Insights" callouts
   - Warning boxes for common mistakes
   - Action items concluding EVERY section
   - Power words and emotional triggers throughout
   - Numbered/bulleted lists for scannability
   - Relevant analogies and metaphors
   - "What This Means For You" sections

LAW #8: E-E-A-T AUTHORITY ESTABLISHMENT
   - First-person experience and insights
   - Expert quotes from industry leaders
   - Credible sources and citations
   - Balanced, nuanced analysis
   - Real case studies and examples
   - Personal anecdotes where appropriate

🎯 MISSION SUCCESS CRITERIA:
- Reader thinks: "This is the BEST content on this topic I've EVER read"
- Covers everything competitors discuss + 50% more unique insights
- Answers every possible question a reader might have
- Provides actionable value in every section
- Becomes the definitive bookmark-worthy resource

FINAL DIRECTIVE: Return ONLY the complete HTML content that will CRUSH all competition and establish absolute topical authority. NO meta tags, titles, or WordPress markup - just pure, dominant content.`;
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