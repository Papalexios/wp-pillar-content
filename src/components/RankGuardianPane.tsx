import React, { useState, useEffect, useMemo } from 'react';

interface RankGuardianPaneProps {
  content: string;
  targetKeyword?: string;
  isVisible: boolean;
  onClose: () => void;
}

interface ScoringMetrics {
  seoScore: number;
  contentScore: number;
  wordCount: number;
  keywordDensity: number;
  readabilityScore: number;
  structureScore: number;
}

export const RankGuardianPane: React.FC<RankGuardianPaneProps> = ({
  content,
  targetKeyword = '',
  isVisible,
  onClose
}) => {
  const [metrics, setMetrics] = useState<ScoringMetrics>({
    seoScore: 0,
    contentScore: 0,
    wordCount: 0,
    keywordDensity: 0,
    readabilityScore: 0,
    structureScore: 0
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Debounced analysis function
  const analyzeContent = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    
    return (contentToAnalyze: string) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      timeoutId = setTimeout(() => {
        if (!contentToAnalyze.trim()) return;
        
        setIsAnalyzing(true);
        
        // Calculate metrics
        const cleanText = contentToAnalyze.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = cleanText.split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;
        
        // Keyword density calculation
        let keywordDensity = 0;
        if (targetKeyword && wordCount > 0) {
          const keywordMatches = cleanText.toLowerCase().split(targetKeyword.toLowerCase()).length - 1;
          keywordDensity = (keywordMatches / wordCount) * 100;
        }
        
        // Structure score (based on headings, lists, etc.)
        const headingCount = (contentToAnalyze.match(/<h[1-6][^>]*>/gi) || []).length;
        const listCount = (contentToAnalyze.match(/<[ou]l[^>]*>/gi) || []).length;
        const structureScore = Math.min(100, (headingCount * 10) + (listCount * 5) + 20);
        
        // Readability score (simplified Flesch formula approximation)
        const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        const avgWordsPerSentence = sentences > 0 ? wordCount / sentences : 0;
        const avgSyllablesPerWord = words.length > 0 ? 
          words.reduce((sum, word) => sum + estimateSyllables(word), 0) / words.length : 0;
        
        const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
        const readabilityScore = Math.max(0, Math.min(100, fleschScore));
        
        // SEO Score calculation
        const seoFactors = [
          wordCount >= 1000 ? 25 : (wordCount / 1000) * 25, // Word count factor
          keywordDensity >= 0.5 && keywordDensity <= 2.5 ? 25 : Math.max(0, 25 - Math.abs(keywordDensity - 1.5) * 10), // Keyword density
          structureScore * 0.25, // Structure factor
          headingCount >= 5 ? 25 : (headingCount / 5) * 25 // Heading factor
        ];
        const seoScore = Math.round(seoFactors.reduce((sum, factor) => sum + factor, 0));
        
        // Content Score calculation
        const contentFactors = [
          readabilityScore * 0.4, // Readability is 40% of content score
          wordCount >= 2000 ? 30 : (wordCount / 2000) * 30, // Comprehensiveness
          structureScore * 0.3, // Organization
        ];
        const contentScore = Math.round(contentFactors.reduce((sum, factor) => sum + factor, 0));
        
        setMetrics({
          seoScore: Math.min(100, seoScore),
          contentScore: Math.min(100, contentScore),
          wordCount,
          keywordDensity: Math.round(keywordDensity * 100) / 100,
          readabilityScore: Math.round(readabilityScore),
          structureScore: Math.round(structureScore)
        });
        
        setIsAnalyzing(false);
      }, 1000); // 1 second debounce
    };
  }, [targetKeyword]);

  useEffect(() => {
    if (content && isVisible) {
      analyzeContent(content);
    }
  }, [content, isVisible, analyzeContent]);

  // Estimate syllables in a word (simplified)
  const estimateSyllables = (word: string): number => {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return '#4ade80'; // Green
    if (score >= 60) return '#facc15'; // Yellow  
    if (score >= 40) return '#fb923c'; // Orange
    return '#f87171'; // Red
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Work';
  };

  if (!isVisible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: '350px',
      height: '100vh',
      backgroundColor: 'var(--surface-color)',
      border: '1px solid var(--border-color)',
      borderRight: 'none',
      zIndex: 1000,
      overflow: 'auto',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.3)'
    }}>
      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h3 style={{ margin: 0, color: 'var(--text-heading-color)', fontSize: '1.25rem' }}>
            🎯 Rank Guardian
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: 'var(--text-light-color)',
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            ×
          </button>
        </div>

        {isAnalyzing && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="spinner" style={{ width: '30px', height: '30px', margin: '0 auto 1rem' }}></div>
            <p style={{ color: 'var(--text-light-color)' }}>Analyzing content...</p>
          </div>
        )}

        {!isAnalyzing && (
          <>
            {/* SEO Score */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, color: 'var(--text-heading-color)' }}>SEO Score</h4>
                <span style={{ 
                  color: getScoreColor(metrics.seoScore),
                  fontWeight: 'bold',
                  fontSize: '1.1rem'
                }}>
                  {metrics.seoScore}/100
                </span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'var(--border-color)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${metrics.seoScore}%`,
                  height: '100%',
                  backgroundColor: getScoreColor(metrics.seoScore),
                  transition: 'width 0.5s ease'
                }}></div>
              </div>
              <p style={{ 
                margin: '0.5rem 0 0', 
                fontSize: '0.875rem', 
                color: getScoreColor(metrics.seoScore),
                fontWeight: '500'
              }}>
                {getScoreLabel(metrics.seoScore)}
              </p>
            </div>

            {/* Content Score */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, color: 'var(--text-heading-color)' }}>Content Score</h4>
                <span style={{ 
                  color: getScoreColor(metrics.contentScore),
                  fontWeight: 'bold',
                  fontSize: '1.1rem'
                }}>
                  {metrics.contentScore}/100
                </span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'var(--border-color)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${metrics.contentScore}%`,
                  height: '100%',
                  backgroundColor: getScoreColor(metrics.contentScore),
                  transition: 'width 0.5s ease'
                }}></div>
              </div>
              <p style={{ 
                margin: '0.5rem 0 0', 
                fontSize: '0.875rem', 
                color: getScoreColor(metrics.contentScore),
                fontWeight: '500'
              }}>
                {getScoreLabel(metrics.contentScore)}
              </p>
            </div>

            {/* Detailed Metrics */}
            <div style={{ 
              backgroundColor: 'var(--surface-glass)', 
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem'
            }}>
              <h5 style={{ margin: '0 0 1rem', color: 'var(--text-heading-color)' }}>Detailed Metrics</h5>
              
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-light-color)' }}>Word Count:</span>
                  <span style={{ color: 'var(--text-color)', fontWeight: '500' }}>
                    {metrics.wordCount.toLocaleString()}
                  </span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-light-color)' }}>Keyword Density:</span>
                  <span style={{ 
                    color: metrics.keywordDensity >= 0.5 && metrics.keywordDensity <= 2.5 ? 
                      'var(--success-color)' : 'var(--warning-color)',
                    fontWeight: '500'
                  }}>
                    {metrics.keywordDensity}%
                  </span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-light-color)' }}>Readability:</span>
                  <span style={{ 
                    color: getScoreColor(metrics.readabilityScore),
                    fontWeight: '500'
                  }}>
                    {metrics.readabilityScore}/100
                  </span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-light-color)' }}>Structure:</span>
                  <span style={{ 
                    color: getScoreColor(metrics.structureScore),
                    fontWeight: '500'
                  }}>
                    {metrics.structureScore}/100
                  </span>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div style={{ marginTop: '1.5rem' }}>
              <h5 style={{ margin: '0 0 1rem', color: 'var(--text-heading-color)' }}>Recommendations</h5>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-light-color)', lineHeight: '1.5' }}>
                {metrics.wordCount < 1000 && (
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--warning-color)' }}>
                    • Add more content (aim for 1000+ words)
                  </p>
                )}
                {(metrics.keywordDensity < 0.5 || metrics.keywordDensity > 2.5) && (
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--warning-color)' }}>
                    • Optimize keyword density (0.5-2.5% is ideal)
                  </p>
                )}
                {metrics.structureScore < 70 && (
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--warning-color)' }}>
                    • Add more headings and lists for better structure
                  </p>
                )}
                {metrics.readabilityScore < 60 && (
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--warning-color)' }}>
                    • Simplify sentences for better readability
                  </p>
                )}
                {metrics.seoScore >= 80 && metrics.contentScore >= 80 && (
                  <p style={{ margin: '0', color: 'var(--success-color)' }}>
                    ✅ Excellent optimization! This content is ready to rank.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};