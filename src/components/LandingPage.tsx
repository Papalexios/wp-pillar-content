import React from 'react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  return (
    <div className="landing-intro">
      <h1 className="usp-headline">
        AI Content Engine for WordPress
      </h1>
      <p className="usp-subheadline">
        Generate high-ranking, E-E-A-T optimized content that dominates search results. 
        Automate internal linking, competitive analysis, and schema markup for maximum SEO impact.
      </p>

      <div className="features-grid">
        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.516 6.516 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5Z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>10x Competitive Analysis</h3>
            <p>AI analyzes top-ranking content to identify gaps and creates superior articles that outrank the competition.</p>
          </div>
        </div>

        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>E-E-A-T Optimization</h3>
            <p>Automatically inject Experience, Expertise, Authoritativeness, and Trust signals into your content.</p>
          </div>
        </div>

        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>Automated Internal Linking</h3>
            <p>Smart AI identifies contextually relevant linking opportunities and builds powerful topical authority.</p>
          </div>
        </div>

        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>Dynamic Schema Markup</h3>
            <p>Automatically generates the most appropriate schema type (HowTo, Review, Article) for maximum rich snippet potential.</p>
          </div>
        </div>

        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>Performance Optimized</h3>
            <p>Handles 1,000+ posts with list virtualization and Web Workers for smooth, crash-free operation.</p>
          </div>
        </div>

        <div className="feature">
          <div className="feature-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-1 16H9V7h9v14z"/>
            </svg>
          </div>
          <div className="feature-content">
            <h3>Content Cluster Strategy</h3>
            <p>Create comprehensive topic clusters with pillar pages and supporting articles for topical authority.</p>
          </div>
        </div>
      </div>

      <button 
        type="button" 
        className="btn" 
        onClick={onGetStarted}
        style={{ fontSize: '1.25rem', padding: '1.25rem 3rem' }}
      >
        Start Optimizing Your Content
      </button>

      <div className="risk-reversal">
        <p>
          <strong>Performance Guarantee:</strong> Our advanced algorithms and competitive analysis 
          are designed to create content that outperforms existing articles in your niche. 
          Enterprise-grade performance with Web Workers and virtualization handles sites of any size.
        </p>
      </div>
    </div>
  );
};

// Helper functions for content generation
const generatePillarContent = async (pillarPage: any, options: any) => {
  // Implementation would go here
};

const generateClusterArticle = async (article: any, pillarPage: any, options: any) => {
  // Implementation would go here  
};

const generateInternalLinks = async (cluster: ContentCluster) => {
  // Implementation would go here
};

const perform10xAnalysis = async (keyword: string): Promise<string> => {
  // Implementation would go here
  return 'Competitive insights';
};

const createEnhancedContentBrief = async (
  articleData: any,
  competitorInsights: string,
  includeEEAT: boolean
): Promise<any> => {
  // Implementation would go here
  return {};
};

const generateContentFromBrief = async (brief: any, schemaType: string): Promise<string> => {
  // Implementation would go here
  return 'Generated content';
};

const generateSchemaMarkup = async (schemaType: string, content: string): Promise<any> => {
  // Implementation would go here
  return {};
};

const generateContentForPost = async (postId: number, options: any) => {
  // Implementation would go here
};

const callAIService = async (prompt: string): Promise<string> => {
  // Implementation would go here
  return 'AI response';
};

const createPillarContentPrompt = (pillarPage: any, options: any): string => {
  return `Generate pillar content for: ${pillarPage.title}`;
};

const createClusterArticlePrompt = (article: any, pillarPage: any, options: any): string => {
  return `Generate cluster article: ${article.title}`;
};