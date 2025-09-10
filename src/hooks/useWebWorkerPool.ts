import { useState, useEffect, useCallback, useRef } from 'react';

interface WorkerTask {
  id: string;
  type: string;
  data: any;
  priority: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout?: number;
}

interface WorkerPoolConfig {
  maxWorkers: number;
  taskTimeout: number;
  workerScript: string;
}

export const useWebWorkerPool = (config: WorkerPoolConfig) => {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [availableWorkers, setAvailableWorkers] = useState<Set<number>>(new Set());
  const [taskQueue, setTaskQueue] = useState<WorkerTask[]>([]);
  const [activeTasks, setActiveTasks] = useState<Map<string, number>>(new Map());
  
  const taskMapRef = useRef<Map<string, WorkerTask>>(new Map());
  const workerScriptRef = useRef<string>(config.workerScript);

  // Initialize worker pool
  useEffect(() => {
    const newWorkers: Worker[] = [];
    const availableSet = new Set<number>();

    for (let i = 0; i < config.maxWorkers; i++) {
      try {
        const blob = new Blob([workerScriptRef.current], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        
        worker.onmessage = (event) => handleWorkerMessage(i, event);
        worker.onerror = (error) => handleWorkerError(i, error);
        
        newWorkers.push(worker);
        availableSet.add(i);
      } catch (error) {
        console.error('Failed to create worker:', error);
      }
    }

    setWorkers(newWorkers);
    setAvailableWorkers(availableSet);

    return () => {
      newWorkers.forEach(worker => worker.terminate());
    };
  }, [config.maxWorkers]);

  // Handle worker messages
  const handleWorkerMessage = useCallback((workerIndex: number, event: MessageEvent) => {
    const { type, data, id, error } = event.data;
    const task = taskMapRef.current.get(id);

    if (!task) return;

    // Remove from active tasks
    setActiveTasks(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });

    // Mark worker as available
    setAvailableWorkers(prev => new Set([...prev, workerIndex]));

    // Clean up task
    taskMapRef.current.delete(id);

    // Handle response
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(data);
    }

    // Process next task in queue
    processNextTask();
  }, []);

  // Handle worker errors
  const handleWorkerError = useCallback((workerIndex: number, error: ErrorEvent) => {
    console.error(`Worker ${workerIndex} error:`, error);
    
    // Find and reject any active task for this worker
    const activeTaskId = Array.from(activeTasks.entries())
      .find(([, index]) => index === workerIndex)?.[0];
    
    if (activeTaskId) {
      const task = taskMapRef.current.get(activeTaskId);
      if (task) {
        task.reject(new Error(`Worker error: ${error.message}`));
        taskMapRef.current.delete(activeTaskId);
      }
      
      setActiveTasks(prev => {
        const newMap = new Map(prev);
        newMap.delete(activeTaskId);
        return newMap;
      });
    }

    // Mark worker as available
    setAvailableWorkers(prev => new Set([...prev, workerIndex]));
    
    // Process next task
    processNextTask();
  }, [activeTasks]);

  // Process next task in queue
  const processNextTask = useCallback(() => {
    setTaskQueue(prevQueue => {
      if (prevQueue.length === 0) return prevQueue;

      setAvailableWorkers(prevAvailable => {
        if (prevAvailable.size === 0) return prevAvailable;

        // Get highest priority task
        const sortedQueue = [...prevQueue].sort((a, b) => b.priority - a.priority);
        const nextTask = sortedQueue[0];
        
        if (!nextTask) return prevAvailable;

        // Get available worker
        const workerIndex = Array.from(prevAvailable)[0];
        const worker = workers[workerIndex];
        
        if (!worker) return prevAvailable;

        // Send task to worker
        worker.postMessage({
          type: nextTask.type,
          data: nextTask.data,
          id: nextTask.id
        });

        // Set timeout for task
        if (nextTask.timeout) {
          setTimeout(() => {
            const task = taskMapRef.current.get(nextTask.id);
            if (task) {
              task.reject(new Error('Task timeout'));
              taskMapRef.current.delete(nextTask.id);
              
              setActiveTasks(prev => {
                const newMap = new Map(prev);
                newMap.delete(nextTask.id);
                return newMap;
              });
              
              setAvailableWorkers(prev => new Set([...prev, workerIndex]));
            }
          }, nextTask.timeout);
        }

        // Update active tasks
        setActiveTasks(prev => new Map([...prev, [nextTask.id, workerIndex]]));
        
        // Remove from available workers
        const newAvailable = new Set(prevAvailable);
        newAvailable.delete(workerIndex);
        
        return newAvailable;
      });

      // Remove processed task from queue
      return prevQueue.filter(task => task.id !== prevQueue[0]?.id);
    });
  }, [workers]);

  // Add task to queue
  const addTask = useCallback(<T = any>(
    type: string, 
    data: any, 
    priority: number = 0,
    timeout?: number
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const task: WorkerTask = {
        id,
        type,
        data,
        priority,
        resolve,
        reject,
        timeout: timeout || config.taskTimeout
      };

      taskMapRef.current.set(id, task);
      
      setTaskQueue(prev => {
        const newQueue = [...prev, task].sort((a, b) => b.priority - a.priority);
        return newQueue;
      });

      // Try to process immediately if worker available
      setTimeout(processNextTask, 0);
    });
  }, [config.taskTimeout, processNextTask]);

  // Cancel task
  const cancelTask = useCallback((taskId: string) => {
    const task = taskMapRef.current.get(taskId);
    if (task) {
      task.reject(new Error('Task cancelled'));
      taskMapRef.current.delete(taskId);
    }

    setTaskQueue(prev => prev.filter(t => t.id !== taskId));
    
    setActiveTasks(prev => {
      const workerIndex = prev.get(taskId);
      if (workerIndex !== undefined) {
        setAvailableWorkers(avail => new Set([...avail, workerIndex]));
      }
      
      const newMap = new Map(prev);
      newMap.delete(taskId);
      return newMap;
    });
  }, []);

  // Get pool statistics
  const getStats = useCallback(() => {
    return {
      totalWorkers: workers.length,
      availableWorkers: availableWorkers.size,
      activeWorkers: workers.length - availableWorkers.size,
      queuedTasks: taskQueue.length,
      activeTasks: activeTasks.size
    };
  }, [workers.length, availableWorkers.size, taskQueue.length, activeTasks.size]);

  return {
    addTask,
    cancelTask,
    getStats,
    isReady: workers.length > 0,
    stats: getStats()
  };
};