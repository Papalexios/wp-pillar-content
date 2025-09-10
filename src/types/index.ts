export interface WordPressPost {
  id: number;
  title: string;
  slug: string;
  status: 'ready' | 'generating' | 'done' | 'error' | 'idle';
  lastModified: string;
  wordCount: number;
  url: string;
  isStale?: boolean;
  content?: string;
  mainContent?: string;
  analysisComplete?: boolean;
}

export interface ContentCluster {
  id: string;
  pillarPage: {
    title: string;
    slug: string;
    content?: string;
  };
  clusterArticles: Array<{
    title: string;
    slug: string;
    content?: string;
    keywords: string[];
  }>;
}

export interface SitemapEntry {
  url: string;
  lastModified: string;
  priority: number;
  changeFreq: string;
}

export interface SchemaType {
  type: 'HowTo' | 'Review' | 'Article' | 'VideoObject' | 'FAQPage';
  data: Record<string, any>;
}

export interface EEATSignals {
  authoritative: {
    expertQuotes: string[];
    studies: string[];
    sources: string[];
  };
  experiential: {
    personalAnecdotes: string[];
    firstPersonInsights: string[];
  };
  trustworthy: {
    prosAndCons: Array<{ pro: string; con: string }>;
    balancedAnalysis: string[];
  };
}

export interface CompetitorAnalysis {
  url: string;
  title: string;
  wordCount: number;
  topics: string[];
  keyArguments: string[];
  uniquePoints: string[];
  missingTopics: string[];
}

export interface ContentBrief {
  title: string;
  outline: string[];
  competitorGaps: string[];
  eeatRequirements: EEATSignals;
  schemaType: SchemaType;
  targetKeywords: string[];
}