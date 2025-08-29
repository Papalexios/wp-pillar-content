import React, { useState, useEffect } from 'react';

interface ConfigStepProps {
  onComplete: (config: any) => void;
  initialConfig?: any;
}

export const ConfigStep: React.FC<ConfigStepProps> = ({ onComplete, initialConfig = {} }) => {
  const [config, setConfig] = useState({
    wpSiteUrl: '',
    geminiApiKey: '',
    openaiApiKey: '',
    anthropicApiKey: '',
    openrouterApiKey: '',
    openrouterModel: '',
    selectedProvider: 'gemini',
    enableAdvancedFeatures: false,
    ...initialConfig
  });

  const [keyStatuses, setKeyStatuses] = useState<Record<string, 'validating' | 'valid' | 'invalid' | null>>({
    gemini: null,
    openai: null,
    anthropic: null,
    openrouter: null
  });

  const validateApiKey = async (provider: string, apiKey: string) => {
    if (!apiKey.trim()) {
      setKeyStatuses(prev => ({ ...prev, [provider]: null }));
      return;
    }

    setKeyStatuses(prev => ({ ...prev, [provider]: 'validating' }));

    try {
      // Simulate API key validation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Basic format validation
      let isValid = false;
      switch (provider) {
        case 'gemini':
          isValid = apiKey.startsWith('AIza') && apiKey.length > 20;
          break;
        case 'openai':
          isValid = apiKey.startsWith('sk-') && apiKey.length > 20;
          break;
        case 'anthropic':
          isValid = apiKey.startsWith('sk-ant-') && apiKey.length > 20;
          break;
        case 'openrouter':
          isValid = apiKey.startsWith('sk-or-') && apiKey.length > 20;
          break;
      }

      setKeyStatuses(prev => ({ ...prev, [provider]: isValid ? 'valid' : 'invalid' }));
    } catch {
      setKeyStatuses(prev => ({ ...prev, [provider]: 'invalid' }));
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (config.geminiApiKey) validateApiKey('gemini', config.geminiApiKey);
    }, 500);
    return () => clearTimeout(timeout);
  }, [config.geminiApiKey]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (config.openaiApiKey) validateApiKey('openai', config.openaiApiKey);
    }, 500);
    return () => clearTimeout(timeout);
  }, [config.openaiApiKey]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (config.anthropicApiKey) validateApiKey('anthropic', config.anthropicApiKey);
    }, 500);
    return () => clearTimeout(timeout);
  }, [config.anthropicApiKey]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (config.openrouterApiKey) validateApiKey('openrouter', config.openrouterApiKey);
    }, 500);
    return () => clearTimeout(timeout);
  }, [config.openrouterApiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete(config);
  };

  const isFormValid = config.wpSiteUrl && 
    ((config.selectedProvider === 'gemini' && keyStatuses.gemini === 'valid') ||
     (config.selectedProvider === 'openai' && keyStatuses.openai === 'valid') ||
     (config.selectedProvider === 'anthropic' && keyStatuses.anthropic === 'valid') ||
     (config.selectedProvider === 'openrouter' && keyStatuses.openrouter === 'valid' && config.openrouterModel.trim()));

  const renderKeyStatusIcon = (provider: string) => {
    const status = keyStatuses[provider];
    if (!status) return null;
    
    return (
      <div className={`key-status-icon ${status}`}>
        {status === 'validating' && <div className="key-status-spinner"></div>}
        {status === 'valid' && <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
        {status === 'invalid' && <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>}
      </div>
    );
  };

  return (
    <div className="step-container">
      <form onSubmit={handleSubmit}>
        <div className="config-forms-wrapper">
          <fieldset className="config-fieldset">
            <legend>WordPress Configuration</legend>
            <div className="form-group">
              <label htmlFor="wpSiteUrl">WordPress Site URL</label>
              <input
                type="url"
                id="wpSiteUrl"
                value={config.wpSiteUrl}
                onChange={(e) => setConfig(prev => ({ ...prev, wpSiteUrl: e.target.value }))}
                placeholder="https://your-wordpress-site.com"
                required
              />
              <div className="help-text">
                Enter your WordPress site URL. We'll use this to fetch your existing content and generate improvements.
              </div>
            </div>
          </fieldset>

          <fieldset className="config-fieldset">
            <legend>AI Provider Selection</legend>
            <div className="form-group">
              <label htmlFor="provider">Choose AI Provider</label>
              <select
                id="provider"
                value={config.selectedProvider}
                onChange={(e) => setConfig(prev => ({ ...prev, selectedProvider: e.target.value }))}
              >
                <option value="gemini">Google Gemini (Recommended)</option>
                <option value="openai">OpenAI GPT-4</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="openrouter">OpenRouter (Any Model)</option>
              </select>
            </div>

            {config.selectedProvider === 'gemini' && (
              <div className="form-group">
                <div className="api-key-group">
                  <label htmlFor="geminiApiKey">Gemini API Key</label>
                  <input
                    type="password"
                    id="geminiApiKey"
                    value={config.geminiApiKey}
                    onChange={(e) => setConfig(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                    placeholder="AIza..."
                    required
                  />
                  {renderKeyStatusIcon('gemini')}
                </div>
              </div>
            )}

            {config.selectedProvider === 'openai' && (
              <div className="form-group">
                <div className="api-key-group">
                  <label htmlFor="openaiApiKey">OpenAI API Key</label>
                  <input
                    type="password"
                    id="openaiApiKey"
                    value={config.openaiApiKey}
                    onChange={(e) => setConfig(prev => ({ ...prev, openaiApiKey: e.target.value }))}
                    placeholder="sk-..."
                    required
                  />
                  {renderKeyStatusIcon('openai')}
                </div>
              </div>
            )}

            {config.selectedProvider === 'anthropic' && (
              <div className="form-group">
                <div className="api-key-group">
                  <label htmlFor="anthropicApiKey">Anthropic API Key</label>
                  <input
                    type="password"
                    id="anthropicApiKey"
                    value={config.anthropicApiKey}
                    onChange={(e) => setConfig(prev => ({ ...prev, anthropicApiKey: e.target.value }))}
                    placeholder="sk-ant-..."
                    required
                  />
                  {renderKeyStatusIcon('anthropic')}
                </div>
              </div>
            )}

            {config.selectedProvider === 'openrouter' && (
              <>
                <div className="form-group">
                  <div className="api-key-group">
                    <label htmlFor="openrouterApiKey">OpenRouter API Key</label>
                    <input
                      type="password"
                      id="openrouterApiKey"
                      value={config.openrouterApiKey}
                      onChange={(e) => setConfig(prev => ({ ...prev, openrouterApiKey: e.target.value }))}
                      placeholder="sk-or-..."
                      required
                    />
                    {renderKeyStatusIcon('openrouter')}
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="openrouterModel">Model Name</label>
                  <input
                    type="text"
                    id="openrouterModel"
                    value={config.openrouterModel}
                    onChange={(e) => setConfig(prev => ({ ...prev, openrouterModel: e.target.value }))}
                    placeholder="anthropic/claude-3.5-sonnet"
                    required
                  />
                  <div className="help-text">
                    Enter any OpenRouter model name (e.g., anthropic/claude-3.5-sonnet, openai/gpt-4, meta-llama/llama-3.1-405b)
                  </div>
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="config-fieldset">
            <legend>Advanced Features</legend>
            <div className="checkbox-group">
              <input
                type="checkbox"
                id="enableAdvancedFeatures"
                checked={config.enableAdvancedFeatures}
                onChange={(e) => setConfig(prev => ({ ...prev, enableAdvancedFeatures: e.target.checked }))}
              />
              <label htmlFor="enableAdvancedFeatures">
                Enable Advanced Features (E-E-A-T optimization, competitive analysis, schema diversity)
              </label>
            </div>
            <div className="help-text">
              Advanced features include automated internal linking, diverse schema markup generation, 
              E-E-A-T signal integration, and competitive gap analysis for superior content.
            </div>
          </fieldset>
        </div>

        <button type="submit" className="btn" disabled={!isFormValid}>
          Continue to Content Strategy
        </button>
      </form>
    </div>
  );
};