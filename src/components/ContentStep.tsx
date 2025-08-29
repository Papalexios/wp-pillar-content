import React, { Suspense, lazy } from 'react';

// Lazy load heavy components
const StrategistHub = lazy(() => import('./StrategistHub.tsx'));
const SingleArticleHub = lazy(() => import('./SingleArticleHub.tsx'));
const ExistingContentHub = lazy(() => import('./ExistingContentHub.tsx'));

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

      <Suspense fallback={
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '400px',
          color: 'var(--text-light-color)'
        }}>
          <div className="spinner" style={{ width: '40px', height: '40px', marginRight: '1rem' }}></div>
          Loading component...
        </div>
      }>
        {activeMode === 'strategist' && (
          <StrategistHub config={config} onComplete={onComplete} />
        )}
        {activeMode === 'single' && (
          <SingleArticleHub config={config} onComplete={onComplete} />
        )}
        {activeMode === 'existing' && (
          <ExistingContentHub config={config} onComplete={onComplete} />
        )}
      </Suspense>
    </div>
  );
};