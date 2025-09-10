import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheManager } from '../utils/cacheManager';

interface PrefetchItem {
  key: string;
  priority: number;
  estimatedSize: number;
  lastAccessed: number;
}

interface PrefetchConfig {
  maxConcurrent: number;
  maxCacheSize: number;
  prefetchThreshold: number;
  userBehaviorWeight: number;
}

export const usePredictivePrefetch = (config: PrefetchConfig = {
  maxConcurrent: 3,
  maxCacheSize: 50 * 1024 * 1024, // 50MB
  prefetchThreshold: 0.7,
  userBehaviorWeight: 0.3
}) => {
  const [prefetchQueue, setPrefetchQueue] = useState<PrefetchItem[]>([]);
  const [activePrefetches, setActivePrefetches] = useState(new Set<string>());
  const [userBehaviorMap, setUserBehaviorMap] = useState(new Map<string, number>());
  
  const prefetchWorkerRef = useRef<Worker | null>(null);
  const behaviorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize predictive prefetch worker
  useEffect(() => {
    // Create a simple prefetch worker
    const workerScript = `
      class PredictivePrefetcher {
        constructor() {
          self.addEventListener('message', this.handleMessage.bind(this));
          this.cache = new Map();
          this.fetchQueue = [];
          this.isProcessing = false;
        }

        handleMessage(event) {
          const { type, data } = event.data;
          
          switch (type) {
            case 'PREFETCH_REQUEST':
              this.queuePrefetch(data);
              break;
            case 'CANCEL_PREFETCH':
              this.cancelPrefetch(data.key);
              break;
            case 'GET_CACHE_STATUS':
              this.getCacheStatus();
              break;
          }
        }

        async queuePrefetch(data) {
          this.fetchQueue.push(data);
          this.fetchQueue.sort((a, b) => b.priority - a.priority);
          
          if (!this.isProcessing) {
            this.processPrefetchQueue();
          }
        }

        async processPrefetchQueue() {
          this.isProcessing = true;
          
          while (this.fetchQueue.length > 0) {
            const item = this.fetchQueue.shift();
            
            try {
              self.postMessage({
                type: 'PREFETCH_STARTED',
                data: { key: item.key }
              });

              const response = await fetch(item.url);
              const data = await response.text();
              
              this.cache.set(item.key, {
                data,
                timestamp: Date.now(),
                size: new Blob([data]).size
              });

              self.postMessage({
                type: 'PREFETCH_COMPLETED',
                data: { key: item.key, size: new Blob([data]).size }
              });

            } catch (error) {
              self.postMessage({
                type: 'PREFETCH_FAILED',
                data: { key: item.key, error: error.message }
              });
            }

            // Small delay to prevent overwhelming the network
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          this.isProcessing = false;
        }

        cancelPrefetch(key) {
          this.fetchQueue = this.fetchQueue.filter(item => item.key !== key);
          
          self.postMessage({
            type: 'PREFETCH_CANCELLED',
            data: { key }
          });
        }

        getCacheStatus() {
          const status = {
            cacheSize: this.cache.size,
            totalSize: Array.from(this.cache.values())
              .reduce((sum, item) => sum + item.size, 0),
            keys: Array.from(this.cache.keys())
          };
          
          self.postMessage({
            type: 'CACHE_STATUS',
            data: status
          });
        }
      }

      new PredictivePrefetcher();
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    prefetchWorkerRef.current = new Worker(URL.createObjectURL(blob));

    prefetchWorkerRef.current.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'PREFETCH_STARTED':
          setActivePrefetches(prev => new Set([...prev, data.key]));
          break;
        case 'PREFETCH_COMPLETED':
          setActivePrefetches(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.key);
            return newSet;
          });
          updateUserBehavior(data.key, 'completed');
          break;
        case 'PREFETCH_FAILED':
          setActivePrefetches(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.key);
            return newSet;
          });
          console.warn('Prefetch failed for:', data.key, data.error);
          break;
        case 'PREFETCH_CANCELLED':
          setActivePrefetches(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.key);
            return newSet;
          });
          break;
      }
    };

    return () => {
      if (prefetchWorkerRef.current) {
        prefetchWorkerRef.current.terminate();
      }
      if (behaviorTimeoutRef.current) {
        clearTimeout(behaviorTimeoutRef.current);
      }
    };
  }, []);

  // Update user behavior patterns
  const updateUserBehavior = useCallback((key: string, action: string) => {
    setUserBehaviorMap(prev => {
      const newMap = new Map(prev);
      const currentWeight = newMap.get(key) || 0;
      
      switch (action) {
        case 'accessed':
          newMap.set(key, Math.min(1, currentWeight + 0.1));
          break;
        case 'completed':
          newMap.set(key, Math.min(1, currentWeight + 0.05));
          break;
        case 'ignored':
          newMap.set(key, Math.max(0, currentWeight - 0.05));
          break;
      }
      
      return newMap;
    });

    // Debounced behavior analysis
    if (behaviorTimeoutRef.current) {
      clearTimeout(behaviorTimeoutRef.current);
    }
    
    behaviorTimeoutRef.current = setTimeout(() => {
      analyzeBehaviorPatterns();
    }, 1000);
  }, []);

  // Analyze user behavior patterns
  const analyzeBehaviorPatterns = useCallback(() => {
    // Update prefetch priorities based on user behavior
    setPrefetchQueue(prev => 
      prev.map(item => {
        const behaviorScore = userBehaviorMap.get(item.key) || 0;
        const timeSinceAccess = Date.now() - item.lastAccessed;
        const recencyScore = Math.exp(-timeSinceAccess / (1000 * 60 * 60)); // Exponential decay over hours
        
        return {
          ...item,
          priority: (item.priority * (1 - config.userBehaviorWeight)) + 
                   (behaviorScore * recencyScore * config.userBehaviorWeight)
        };
      }).sort((a, b) => b.priority - a.priority)
    );
  }, [userBehaviorMap, config.userBehaviorWeight]);

  // Queue item for prefetching
  const queuePrefetch = useCallback((key: string, url: string, priority: number = 0.5) => {
    const estimatedSize = estimateContentSize(url);
    
    const item: PrefetchItem = {
      key,
      priority,
      estimatedSize,
      lastAccessed: Date.now()
    };

    setPrefetchQueue(prev => {
      const exists = prev.find(item => item.key === key);
      if (exists) {
        return prev.map(item => 
          item.key === key ? { ...item, priority: Math.max(item.priority, priority) } : item
        );
      }
      
      const newQueue = [...prev, item].sort((a, b) => b.priority - a.priority);
      
      // Limit queue size
      return newQueue.slice(0, 50);
    });

    // Start prefetching if under concurrent limit and above threshold
    if (activePrefetches.size < config.maxConcurrent && priority >= config.prefetchThreshold) {
      prefetchWorkerRef.current?.postMessage({
        type: 'PREFETCH_REQUEST',
        data: { key, url, priority }
      });
    }
  }, [activePrefetches.size, config.maxConcurrent, config.prefetchThreshold]);

  // Predictive content prefetching based on current context
  const predictAndPrefetch = useCallback((currentContext: {
    currentStep?: string;
    selectedProvider?: string;
    recentActions?: string[];
    hoveredElements?: string[];
  }) => {
    const predictions: Array<{ key: string; url: string; priority: number }> = [];

    // Predict based on current step
    if (currentContext.currentStep === 'config') {
      // Likely to go to content step next
      predictions.push({
        key: 'content-step-data',
        url: '/api/content-step-initial',
        priority: 0.8
      });
    }

    // Predict based on AI provider selection
    if (currentContext.selectedProvider === 'gemini') {
      predictions.push({
        key: 'gemini-models',
        url: '/api/gemini/models',
        priority: 0.7
      });
    }

    // Predict based on recent actions
    currentContext.recentActions?.forEach(action => {
      if (action === 'sitemap-crawl-started') {
        predictions.push({
          key: 'content-analysis-templates',
          url: '/api/templates/content-analysis',
          priority: 0.9
        });
      }
    });

    // Predict based on hover behavior
    currentContext.hoveredElements?.forEach(element => {
      if (element.includes('pillar-post')) {
        predictions.push({
          key: 'pillar-post-templates',
          url: '/api/templates/pillar-post',
          priority: 0.6
        });
      }
    });

    // Queue all predictions
    predictions.forEach(prediction => {
      queuePrefetch(prediction.key, prediction.url, prediction.priority);
    });
  }, [queuePrefetch]);

  // Mark content as accessed (for behavior learning)
  const markAccessed = useCallback((key: string) => {
    updateUserBehavior(key, 'accessed');
  }, [updateUserBehavior]);

  // Cancel prefetch
  const cancelPrefetch = useCallback((key: string) => {
    prefetchWorkerRef.current?.postMessage({
      type: 'CANCEL_PREFETCH',
      data: { key }
    });
  }, []);

  // Get prefetch statistics
  const getStats = useCallback(() => {
    return {
      queueSize: prefetchQueue.length,
      activePrefetches: activePrefetches.size,
      behaviorPatterns: userBehaviorMap.size,
      highPriorityItems: prefetchQueue.filter(item => item.priority >= config.prefetchThreshold).length
    };
  }, [prefetchQueue.length, activePrefetches.size, userBehaviorMap.size, prefetchQueue, config.prefetchThreshold]);

  return {
    queuePrefetch,
    predictAndPrefetch,
    markAccessed,
    cancelPrefetch,
    getStats,
    prefetchQueue: prefetchQueue.slice(0, 10), // Only expose top 10 for UI
    activePrefetches,
    isActive: activePrefetches.size > 0
  };
};

// Estimate content size based on URL patterns
function estimateContentSize(url: string): number {
  if (url.includes('/api/content/')) return 50000; // ~50KB for content
  if (url.includes('/api/templates/')) return 10000; // ~10KB for templates
  if (url.includes('/api/models/')) return 5000; // ~5KB for model data
  return 20000; // Default ~20KB
}