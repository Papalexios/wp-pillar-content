import React, { useState } from 'react';
import { useContentGeneration } from '../hooks/useContentGeneration';
import { SchemaType } from '../types';

interface SingleArticleHubProps {
  config: any;
  onComplete: () => void;
}

const SingleArticleHub: React.FC<SingleArticleHubProps> = ({ config, onComplete }) => {
  const [articleData, setArticleData] = useState({
    title: '',
    targetKeyword: '',
    metaDescription: '',
    contentBrief: '',
    schemaType: 'Article' as SchemaType['type'],
    includeEEAT: config.enableAdvancedFeatures || false,
    performCompetitorAnalysis: config.enableAdvancedFeatures || false
  });

  const { generateSingleArticle, isGeneratingContent, progress } = useContentGeneration(config);

  const handleGenerate = async () => {
    try {
      await generateSingleArticle({
        ...articleData,
        eeatSignals: articleData.includeEEAT,
        competitorAnalysis: articleData.performCompetitorAnalysis
      });
      onComplete();
    } catch (error) {
      console.error('Error generating article:', error);
    }
  };

  const isFormValid = articleData.title && articleData.targetKeyword && articleData.contentBrief;

  return (
    <div className="single-article-hub">
      <h2>Single Article Generator</h2>
      <p>
        Create a single, high-quality article optimized for search rankings with advanced 
        E-E-A-T signals and competitive analysis.
      </p>

      <div style={{ textAlign: 'left', maxWidth: '800px', margin: '0 auto' }}>
        <div className="form-group">
          <label htmlFor="articleTitle">Article Title</label>
          <input
            type="text"
            id="articleTitle"
            value={articleData.title}
            onChange={(e) => setArticleData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Complete Guide to Content Marketing Strategy"
          />
        </div>

        <div className="form-group">
          <label htmlFor="targetKeyword">Primary Target Keyword</label>
          <input
            type="text"
            id="targetKeyword"
            value={articleData.targetKeyword}
            onChange={(e) => setArticleData(prev => ({ ...prev, targetKeyword: e.target.value }))}
            placeholder="content marketing strategy"
          />
        </div>

        <div className="form-group">
          <div className="label-wrapper">
            <label htmlFor="metaDescription">Meta Description</label>
            <span className="char-counter">{articleData.metaDescription.length}/160</span>
          </div>
          <textarea
            id="metaDescription"
            className="meta-description-input"
            value={articleData.metaDescription}
            onChange={(e) => setArticleData(prev => ({ ...prev, metaDescription: e.target.value }))}
            placeholder="Discover proven content marketing strategies that drive results..."
            maxLength={160}
          />
        </div>

        <div className="form-group">
          <label htmlFor="contentBrief">Content Brief</label>
          <textarea
            id="contentBrief"
            value={articleData.contentBrief}
            onChange={(e) => setArticleData(prev => ({ ...prev, contentBrief: e.target.value }))}
            placeholder="Provide a detailed brief about what this article should cover, target audience, key points to address, etc."
          />
        </div>

        <div className="form-group">
          <label htmlFor="schemaType">Schema Markup Type</label>
          <select
            id="schemaType"
            value={articleData.schemaType}
            onChange={(e) => setArticleData(prev => ({ ...prev, schemaType: e.target.value as SchemaType['type'] }))}
          >
            <option value="Article">Article (Standard)</option>
            <option value="HowTo">HowTo (Tutorial/Guide)</option>
            <option value="Review">Review (Product/Service)</option>
            <option value="FAQPage">FAQ Page</option>
            <option value="VideoObject">Video Content</option>
          </select>
        </div>

        {config.enableAdvancedFeatures && (
          <>
            <div className="checkbox-group">
              <input
                type="checkbox"
                id="includeEEAT"
                checked={articleData.includeEEAT}
                onChange={(e) => setArticleData(prev => ({ ...prev, includeEEAT: e.target.checked }))}
              />
              <label htmlFor="includeEEAT">
                Include E-E-A-T Optimization (Expert quotes, personal insights, balanced analysis)
              </label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="performCompetitorAnalysis"
                checked={articleData.performCompetitorAnalysis}
                onChange={(e) => setArticleData(prev => ({ ...prev, performCompetitorAnalysis: e.target.checked }))}
              />
              <label htmlFor="performCompetitorAnalysis">
                Perform 10x Competitive Analysis (Analyze top 3 ranking articles and create superior content)
              </label>
            </div>
          </>
        )}

        {isGeneratingContent && (
          <div className="bulk-progress-bar">
            <div 
              className="bulk-progress-bar-fill" 
              style={{ width: `${progress}%` }}
            ></div>
            <div className="bulk-progress-bar-text">
              Generating Content... {progress}%
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn"
          onClick={handleGenerate}
          disabled={!isFormValid || isGeneratingContent}
        >
          {isGeneratingContent ? 'Generating Article...' : 'Generate Article'}
        </button>
      </div>
    </div>
  );
};

export default SingleArticleHub;