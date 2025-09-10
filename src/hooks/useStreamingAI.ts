import { useState, useCallback, useRef } from 'react';
import { cacheManager } from '../utils/cacheManager';

interface StreamingOptions {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: Error) => void;
}

export const useStreamingAI = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const [progress, setProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamAIGeneration = useCallback(async (
    prompt: string,
    config: any,
    options: StreamingOptions = {}
  ) => {
    const { onChunk, onComplete, onError } = options;
    
    setIsStreaming(true);
    setStreamedContent('');
    setProgress(0);
    
    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();
    
    try {
      // Check cache first
      const cacheKey = `ai_content_${btoa(prompt).slice(0, 50)}`;
      const cached = await cacheManager.get(cacheKey);
      
      if (cached) {
        // Simulate streaming for cached content
        await simulateStreaming(cached, onChunk);
        setStreamedContent(cached);
        onComplete?.(cached);
        setProgress(100);
        setIsStreaming(false);
        return cached;
      }

      let fullContent = '';
      
      if (config.selectedProvider === 'openrouter') {
        fullContent = await streamOpenRouterResponse(prompt, config, onChunk);
      } else if (config.selectedProvider === 'gemini') {
        fullContent = await streamGeminiResponse(prompt, config, onChunk);
      } else if (config.selectedProvider === 'openai') {
        fullContent = await streamOpenAIResponse(prompt, config, onChunk);
      } else if (config.selectedProvider === 'anthropic') {
        fullContent = await streamAnthropicResponse(prompt, config, onChunk);
      } else {
        throw new Error(`Unsupported AI provider: ${config.selectedProvider}`);
      }

      setStreamedContent(fullContent);
      setProgress(100);
      
      // Cache the result
      await cacheManager.set(cacheKey, fullContent, 3600000); // 1 hour cache
      
      onComplete?.(fullContent);
      return fullContent;
      
    } catch (error) {
      console.error('Streaming AI generation failed:', error);
      onError?.(error as Error);
      throw error;
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, []);

  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setProgress(0);
      setStreamedContent('');
    }
  }, []);

  return {
    streamAIGeneration,
    cancelStreaming,
    isStreaming,
    streamedContent,
    progress
  };
};

// STREAMING IMPLEMENTATIONS FOR EACH PROVIDER

async function streamOpenRouterResponse(
  prompt: string, 
  config: any, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': document.title || 'WP Content Optimizer'
    },
    body: JSON.stringify({
      model: config.openrouterModel || 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  return await processStreamingResponse(response, onChunk);
}

async function streamGeminiResponse(
  prompt: string, 
  config: any, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  // Gemini doesn't support streaming in browser, so we'll simulate it
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
  
  // Simulate streaming
  await simulateStreaming(fullContent, onChunk);
  
  return fullContent;
}

async function streamOpenAIResponse(
  prompt: string, 
  config: any, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  return await processStreamingResponse(response, onChunk);
}

async function streamAnthropicResponse(
  prompt: string, 
  config: any, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  return await processStreamingResponse(response, onChunk);
}

async function processStreamingResponse(
  response: Response, 
  onChunk?: (chunk: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  let fullContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || parsed.content?.[0]?.text || '';
            
            if (content) {
              fullContent += content;
              onChunk?.(content);
            }
          } catch (e) {
            // Skip invalid JSON
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullContent;
}

async function simulateStreaming(
  fullContent: string, 
  onChunk?: (chunk: string) => void
): Promise<void> {
  const words = fullContent.split(' ');
  const chunkSize = 5; // Words per chunk
  
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ') + ' ';
    onChunk?.(chunk);
    await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay per chunk
  }
}