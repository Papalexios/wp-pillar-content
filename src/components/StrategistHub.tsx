import React, { useState } from 'react';
import { ContentCluster, CompetitorAnalysis, ContentBrief } from '../types';
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis';
import { useContentGeneration } from '../hooks/useContentGeneration';

interface StrategistHubProps {
  config: any;
  onComplete: () => void;
}

const StrategistHub: React.FC<StrategistHubProps> = ({ config, onComplete }) => {
  const [keyword, setKeyword] = useState('');
  const [clusters, setClusters] = useState<ContentCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { analyzeCompetitors, analysis, isAnalyzing } = useCompetitorAnalysis(config);
  const { generateClusterContent, isGeneratingContent } = useContentGeneration(config);

  const handleAnalyzeKeyword = async () => {
    if (!keyword.trim()) return;
    
    setIsGenerating(true);
    try {
      // Step 1: Competitor analysis
      const competitorData = await analyzeCompetitors(keyword);
      
      // Step 2: Generate content clusters based on competitive gaps
      const generatedClusters = await generateContentClusters(keyword, competitorData);
      setClusters(generatedClusters);
      
    } catch (error) {
      console.error('Error analyzing keyword:', error);
    }
    setIsGenerating(false);
  };

  const generateContentClusters = async (
    targetKeyword: string, 
    competitorAnalysis: CompetitorAnalysis[]
  ): Promise<ContentCluster[]> => {
    // Enhanced AI prompt that incorporates competitor gap analysis
    const prompt = `
      Based on the competitive analysis for "${targetKeyword}", create a comprehensive content cluster strategy.
      
      Competitor Analysis Summary:
      ${competitorAnalysis.map(comp => `
        - ${comp.title}: Covers ${comp.topics.join(', ')}
        - Missing: ${comp.missingTopics.join(', ')}
      `).join('\n')}
      
      Generate a content cluster with:
      1. One comprehensive pillar page that covers the main topic better than all competitors
      2. 5-7 supporting cluster articles that target the gaps found in competitor analysis
      3. Each article should include E-E-A-T optimization opportunities
      4. Suggest appropriate schema markup for each piece
      
      Format as JSON with pillar page and cluster articles array.
    `;

    // This would call your AI service
    // For now, return mock data
    return [
      {
        id: '1',
        pillarPage: {
          title: `Complete Guide to ${targetKeyword}`,
          slug: `complete-guide-${targetKeyword.toLowerCase().replace(/\s+/g, '-')}`
        },
        clusterArticles: [
          {
            title: `${targetKeyword} for Beginners`,
            slug: `${targetKeyword.toLowerCase().replace(/\s+/g, '-')}-beginners`,
            keywords: [`${keyword} basics`, `how to start ${keyword}`]
          },
          {
            title: `Advanced ${targetKeyword} Strategies`,
            slug: `advanced-${targetKeyword.toLowerCase().replace(/\s+/g, '-')}-strategies`,
            keywords: [`${keyword} advanced`, `${keyword} expert tips`]
          }
        ]
      }
    ];
  };

  const handleGenerateCluster = async (clusterId: string) => {
    const cluster = clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    try {
      await generateClusterContent(cluster, {
        includeInternalLinks: true,
        enableEEAT: config.enableAdvancedFeatures,
        generateDiverseSchema: config.enableAdvancedFeatures
      });
      
      onComplete();
    } catch (error) {
      console.error('Error generating cluster content:', error);
    }
  };

  return (
    <div className="strategist-hub">
      <h2>AI Content Strategist</h2>
      <p>
        Enter a target keyword to analyze competitors and generate a comprehensive content cluster 
        strategy designed to dominate search rankings.
      </p>

      <div className="form-group">
        <label htmlFor="targetKeyword">Target Keyword</label>
        <input
          type="text"
          id="targetKeyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g., content marketing strategy"
        />
      </div>

      <button
        type="button"
        className="btn"
        onClick={handleAnalyzeKeyword}
        disabled={!keyword.trim() || isGenerating || isAnalyzing}
      >
        {isGenerating || isAnalyzing ? (
          <>
            <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
            Analyzing Competitors & Creating Strategy...
          </>
        ) : (
          'Analyze & Create Cluster Strategy'
        )}
      </button>

      {analysis && analysis.length > 0 && (
        <div className="form-group" style={{ marginTop: '2rem' }}>
          <h3>Competitive Analysis Results</h3>
          <div style={{ 
            background: 'var(--surface-color)', 
            padding: '1rem', 
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            {analysis.map((comp, index) => (
              <div key={index} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: index < analysis.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                <h4 style={{ margin: '0 0 0.5rem', color: 'var(--text-heading-color)' }}>{comp.title}</h4>
                <p style={{ margin: '0', fontSize: '0.9rem', color: 'var(--text-light-color)' }}>
                  {comp.wordCount} words • Missing: {comp.missingTopics.slice(0, 3).join(', ')}
                  {comp.missingTopics.length > 3 && ` +${comp.missingTopics.length - 3} more`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {clusters.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Generated Content Clusters</h3>
          {clusters.map((cluster) => (
            <div 
              key={cluster.id}
              className={`pillar-card ${selectedCluster === cluster.id ? 'selected' : ''}`}
              onClick={() => setSelectedCluster(selectedCluster === cluster.id ? null : cluster.id)}
            >
              <h4 style={{ margin: '0 0 1rem', color: 'var(--text-heading-color)' }}>
                📄 {cluster.pillarPage.title}
              </h4>
              <div style={{ marginBottom: '1rem' }}>
                <strong style={{ color: 'var(--text-color)' }}>Cluster Articles:</strong>
                <ul style={{ margin: '0.5rem 0 0 1rem', color: 'var(--text-light-color)' }}>
                  {cluster.clusterArticles.map((article, index) => (
                    <li key={index} style={{ marginBottom: '0.25rem' }}>
                      {article.title}
                    </li>
                  ))}
                </ul>
              </div>
              
              {selectedCluster === cluster.id && (
                <button
                  type="button"
                  className="btn btn-pillar"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGenerateCluster(cluster.id);
                  }}
                  disabled={isGeneratingContent}
                >
                  {isGeneratingContent ? (
                    <>
                      <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
                      Generating Cluster Content...
                    </>
                  ) : (
                    'Generate This Cluster'
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StrategistHub;