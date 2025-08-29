import React, { Suspense, lazy, useState } from 'react';
import { ProgressBar } from './components/ProgressBar';
import { LandingPage } from './components/LandingPage';

// Lazy load step components for code splitting
const ConfigStep = lazy(() => import('./components/ConfigStep').then(module => ({ default: module.ConfigStep })));
const ContentStep = lazy(() => import('./components/ContentStep').then(module => ({ default: module.ContentStep })));

interface AppConfig {
  wpSiteUrl: string;
  selectedProvider: string;
  enableAdvancedFeatures: boolean;
  [key: string]: any;
}

export const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<'landing' | 'config' | 'content' | 'complete'>('landing');
  const [config, setConfig] = useState<AppConfig | null>(null);

  const steps = [
    { id: 'config', name: 'Configuration', completed: currentStep === 'content' || currentStep === 'complete', active: currentStep === 'config' },
    { id: 'content', name: 'Content Generation', completed: currentStep === 'complete', active: currentStep === 'content' },
    { id: 'complete', name: 'Complete', completed: currentStep === 'complete', active: currentStep === 'complete' }
  ];

  const handleConfigComplete = (newConfig: AppConfig) => {
    setConfig(newConfig);
    setCurrentStep('content');
  };

  const handleContentComplete = () => {
    setCurrentStep('complete');
  };

  const handleGetStarted = () => {
    setCurrentStep('config');
  };

  if (currentStep === 'landing') {
    return (
      <div className="container">
        <div className="app-header">
          <h1>WP Content Optimizer Pro</h1>
        </div>
        <LandingPage onGetStarted={handleGetStarted} />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="app-header">
        <h1>WP Content Optimizer Pro</h1>
        <p className="subtitle">Enterprise-grade content optimization with advanced AI features</p>
      </div>

      {currentStep !== 'landing' && <ProgressBar steps={steps} />}

      <Suspense fallback={
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '400px',
          flexDirection: 'column',
          gap: '1rem',
          color: 'var(--text-light-color)'
        }}>
          <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
          <p>Loading component...</p>
        </div>
      }>
        {currentStep === 'config' && (
          <ConfigStep onComplete={handleConfigComplete} />
        )}
        {currentStep === 'content' && config && (
          <ContentStep config={config} onComplete={handleContentComplete} />
        )}
        {currentStep === 'complete' && (
          <div className="step-container" style={{ textAlign: 'center' }}>
            <h2 style={{ color: 'var(--success-color)', marginBottom: '1rem' }}>
              🎉 Content Generation Complete!
            </h2>
            <p style={{ marginBottom: '2rem', color: 'var(--text-light-color)' }}>
              Your WordPress content has been successfully optimized with advanced AI features.
            </p>
            <button 
              type="button" 
              className="btn"
              onClick={() => window.location.reload()}
            >
              Start New Project
            </button>
          </div>
        )}
      </Suspense>

      <footer className="app-footer">
        <p>
          Powered by advanced AI • 
          <a href="#" target="_blank">Documentation</a> • 
          <a href="#" target="_blank">Support</a>
        </p>
      </footer>
    </div>
  );
};

export default App;