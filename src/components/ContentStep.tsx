import React from 'react';
import { ExistingContentHub } from './ExistingContentHub';

interface ContentStepProps {
  config: any;
  onComplete: () => void;
}

export const ContentStep: React.FC<ContentStepProps> = ({ config, onComplete }) => {
  const [activeMode, setActiveMode] = React.useState<'strategist' | 'single' | 'existing'>('strategist');

  return (
    <div className="step-container full-width">
      <div className="content-mode-toggle">
        <button
          type="button"
          className={activeMode === 'strategist' ? 'active' : ''}
          onClick={() => setActiveMode('strategist')}
        >
          🧠 AI Strategist
        </button>
        <button
          type="button"
          className={activeMode === 'single' ? 'active' : ''}
          onClick={() => setActiveMode('single')}
        >
          ✍️ Single Article
        </button>
        <button
          type="button"
          className={activeMode === 'existing' ? 'active' : ''}
          onClick={() => setActiveMode('existing')}
        >
          🔄 Update Existing
        </button>
      </div>

      {activeMode === 'strategist' && (
        <div className="strategist-hub">
          <h2>🧠 AI Strategist</h2>
          <p>Coming soon - Advanced content strategy planning</p>
        </div>
      )}
      {activeMode === 'single' && (
        <div className="single-article-hub">
          <h2>✍️ Single Article</h2>
          <p>Coming soon - Individual article generation</p>
        </div>
      )}
      {activeMode === 'existing' && (
        <ExistingContentHub config={config} onComplete={onComplete} />
      )}
    </div>
  );
};