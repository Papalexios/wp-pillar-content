// Content Analysis Web Worker - Runs heavy computations in background
class ContentAnalyzerWorker {
  constructor() {
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  private handleMessage(event: MessageEvent) {
    const { type, data, id } = event.data;

    switch (type) {
      case 'ANALYZE_CONTENT':
        this.analyzeContent(data, id);
        break;
      case 'EXTRACT_KEYWORDS':
        this.extractKeywords(data, id);
        break;
      case 'CALCULATE_READABILITY':
        this.calculateReadability(data, id);
        break;
      case 'ANALYZE_BATCH':
        this.analyzeBatch(data, id);
        break;
    }
  }

  private analyzeContent(data: { url: string; html: string; lastMod: string }, id: string) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(data.html, 'text/html');

      // Smart title extraction
      const title = this.extractTitle(doc, data.url);
      
      // Intelligent content extraction
      const mainContent = this.extractMainContent(doc);
      
      // Advanced metrics calculation
      const metrics = this.calculateMetrics(mainContent, title);
      
      // Staleness detection
      const isStale = this.detectStaleness(title, mainContent);
      
      const result = {
        url: data.url,
        title,
        wordCount: metrics.wordCount,
        readabilityScore: metrics.readability,
        keywordDensity: metrics.keywordDensity,
        lastModified: data.lastMod || new Date().toISOString(),
        isStale,
        contentHash: this.generateContentHash(mainContent),
        priority: this.calculatePriority(metrics, isStale),
        changeFreq: this.determineChangeFreq(data.lastMod)
      };

      self.postMessage({ type: 'ANALYSIS_COMPLETE', data: result, id });
    } catch (error) {
      self.postMessage({ type: 'ANALYSIS_ERROR', error: error.message, id });
    }
  }

  private extractTitle(doc: Document, url: string): string {
    // Priority: title tag > h1 > og:title > URL-derived
    const titleElement = doc.querySelector('title');
    const h1Element = doc.querySelector('h1');
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    
    return (
      titleElement?.textContent?.trim() ||
      h1Element?.textContent?.trim() ||
      ogTitle?.getAttribute('content')?.trim() ||
      this.extractTitleFromUrl(url)
    ).substring(0, 200);
  }

  private extractMainContent(doc: Document): string {
    // Smart content selectors in priority order
    const contentSelectors = [
      'main article',
      'main .content',
      'main .post-content',
      'main .entry-content',
      '.main-content article',
      '.content-area article',
      '.post-content',
      '.entry-content',
      'article',
      'main',
      '[role="main"]',
      '.content'
    ];

    let mainContentElement = null;
    for (const selector of contentSelectors) {
      const element = doc.querySelector(selector);
      if (element && element.textContent && element.textContent.trim().length > 100) {
        mainContentElement = element;
        break;
      }
    }

    if (!mainContentElement) {
      mainContentElement = doc.body;
    }

    // Remove noise elements
    const noiseSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.sidebar', '.menu', '.navigation', '.comments', '.comment',
      '.social-share', '.related-posts', '.advertisement', '.ads',
      '.cookie-notice', '.popup', '.modal', '.breadcrumb'
    ];

    const clonedElement = mainContentElement.cloneNode(true) as Element;
    noiseSelectors.forEach(selector => {
      const elements = clonedElement.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    return clonedElement.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  private calculateMetrics(content: string, title: string) {
    const words = content.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    
    // Readability calculation (Flesch formula approximation)
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : 0;
    const avgSyllablesPerWord = words.length > 0 ? 
      words.reduce((sum, word) => sum + this.estimateSyllables(word), 0) / words.length : 0;
    
    const readability = Math.max(0, Math.min(100, 
      206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord)
    ));

    return {
      wordCount,
      readability: Math.round(readability),
      keywordDensity: 0 // Can be calculated if target keyword is provided
    };
  }

  private estimateSyllables(word: string): number {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  private detectStaleness(title: string, content: string): boolean {
    const currentYear = new Date().getFullYear();
    
    // Check title for old years
    const titleYears = title.match(/\b(19|20)\d{2}\b/g);
    const hasOldYearInTitle = titleYears ? 
      titleYears.some(year => parseInt(year) < currentYear) : false;
    
    // Check content for stale indicators
    const staleIndicators = ['updated', 'last modified', 'published', 'copyright'];
    const contentLower = content.toLowerCase();
    const hasStaleContent = staleIndicators.some(indicator => {
      const regex = new RegExp(`${indicator}\\s+(19|20)\\d{2}`, 'i');
      const matches = contentLower.match(regex);
      return matches && matches.some(match => {
        const year = parseInt(match.match(/(19|20)\d{2}/)?.[0] || '0');
        return year < currentYear;
      });
    });

    return hasOldYearInTitle || hasStaleContent;
  }

  private generateContentHash(content: string): string {
    // Simple hash for content fingerprinting
    let hash = 0;
    for (let i = 0; i < Math.min(content.length, 200); i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private calculatePriority(metrics: any, isStale: boolean): number {
    let priority = 0.5;
    if (metrics.wordCount > 2000) priority += 0.2;
    if (metrics.wordCount > 1000) priority += 0.1;
    if (!isStale) priority += 0.1;
    if (metrics.readability > 60) priority += 0.1;
    return Math.min(1.0, priority);
  }

  private determineChangeFreq(lastMod: string): string {
    if (!lastMod) return 'monthly';
    
    const daysSinceModified = (Date.now() - new Date(lastMod).getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceModified < 7) return 'daily';
    if (daysSinceModified < 30) return 'weekly';
    if (daysSinceModified < 90) return 'monthly';
    return 'yearly';
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'page';
      
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/\.(html|php|aspx?)$/i, '');
    } catch {
      return url;
    }
  }

  private extractKeywords(data: { content: string; title: string }, id: string) {
    try {
      // Advanced keyword extraction algorithm
      const text = `${data.title} ${data.content}`.toLowerCase();
      const words = text.match(/\b[a-z]{3,}\b/g) || [];
      
      // Calculate word frequency
      const frequency: Record<string, number> = {};
      words.forEach(word => {
        frequency[word] = (frequency[word] || 0) + 1;
      });

      // Filter out common stop words
      const stopWords = new Set([
        'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should'
      ]);

      const keywords = Object.entries(frequency)
        .filter(([word, count]) => !stopWords.has(word) && count > 1)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([word]) => word);

      self.postMessage({ type: 'KEYWORDS_EXTRACTED', data: keywords, id });
    } catch (error) {
      self.postMessage({ type: 'KEYWORDS_ERROR', error: error.message, id });
    }
  }

  private calculateReadability(data: { content: string }, id: string) {
    try {
      const content = data.content;
      const words = content.split(/\s+/).filter(word => word.length > 0);
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      if (words.length === 0 || sentences.length === 0) {
        self.postMessage({ type: 'READABILITY_COMPLETE', data: { score: 0 }, id });
        return;
      }

      const avgWordsPerSentence = words.length / sentences.length;
      const avgSyllablesPerWord = words.reduce((sum, word) => sum + this.estimateSyllables(word), 0) / words.length;
      
      const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
      const score = Math.max(0, Math.min(100, Math.round(fleschScore)));

      self.postMessage({ type: 'READABILITY_COMPLETE', data: { score }, id });
    } catch (error) {
      self.postMessage({ type: 'READABILITY_ERROR', error: error.message, id });
    }
  }

  private analyzeBatch(data: Array<{ url: string; html: string; lastMod: string }>, id: string) {
    try {
      const results = data.map(item => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(item.html, 'text/html');
        
        const title = this.extractTitle(doc, item.url);
        const mainContent = this.extractMainContent(doc);
        const metrics = this.calculateMetrics(mainContent, title);
        const isStale = this.detectStaleness(title, mainContent);
        
        return {
          url: item.url,
          title,
          wordCount: metrics.wordCount,
          readabilityScore: metrics.readability,
          lastModified: item.lastMod || new Date().toISOString(),
          isStale,
          contentHash: this.generateContentHash(mainContent),
          priority: this.calculatePriority(metrics, isStale),
          changeFreq: this.determineChangeFreq(item.lastMod)
        };
      });

      self.postMessage({ type: 'BATCH_ANALYSIS_COMPLETE', data: results, id });
    } catch (error) {
      self.postMessage({ type: 'BATCH_ANALYSIS_ERROR', error: error.message, id });
    }
  }
}

// Initialize worker
new ContentAnalyzerWorker();