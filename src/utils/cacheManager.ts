/**
 * ADVANCED INDEXEDDB CACHE MANAGER
 * Provides persistent, efficient caching with automatic cleanup
 */

interface CacheItem {
  key: string;
  data: any;
  timestamp: number;
  ttl: number;
  size: number;
}

class IndexedDBCacheManager {
  private dbName = 'WP_Content_Optimizer_Cache';
  private dbVersion = 1;
  private storeName = 'cache';
  private db: IDBDatabase | null = null;
  private maxCacheSize = 50 * 1024 * 1024; // 50MB
  private currentCacheSize = 0;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.calculateCurrentCacheSize();
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async set(key: string, data: any, ttl: number = 3600000): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const serializedData = JSON.stringify(data);
    const size = new Blob([serializedData]).size;
    
    // Check if we need to make space
    if (this.currentCacheSize + size > this.maxCacheSize) {
      await this.cleanup();
    }

    const item: CacheItem = {
      key,
      data: serializedData,
      timestamp: Date.now(),
      ttl,
      size
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(item);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.currentCacheSize += size;
        resolve();
      };
    });
  }

  async get(key: string): Promise<any | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const item = request.result as CacheItem;
        
        if (!item) {
          resolve(null);
          return;
        }

        // Check if expired
        if (Date.now() - item.timestamp > item.ttl) {
          this.delete(key); // Async cleanup
          resolve(null);
          return;
        }

        try {
          const data = JSON.parse(item.data);
          console.log(`[IndexedDB Cache] HIT for key: ${key}`);
          resolve(data);
        } catch (error) {
          console.error('Failed to parse cached data:', error);
          this.delete(key);
          resolve(null);
        }
      };
    });
  }

  async delete(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Get the item first to update cache size
      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        const item = getRequest.result as CacheItem;
        if (item) {
          this.currentCacheSize -= item.size;
        }
        
        const deleteRequest = store.delete(key);
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => resolve();
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async cleanup(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');
      const request = index.openCursor();
      
      const itemsToDelete: string[] = [];
      let freedSpace = 0;
      const targetFreeSpace = this.maxCacheSize * 0.3; // Free 30% of cache

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && freedSpace < targetFreeSpace) {
          const item = cursor.value as CacheItem;
          
          // Delete expired items or oldest items if we need space
          if (Date.now() - item.timestamp > item.ttl || freedSpace < targetFreeSpace) {
            itemsToDelete.push(item.key);
            freedSpace += item.size;
          }
          
          cursor.continue();
        } else {
          // Delete the items
          Promise.all(itemsToDelete.map(key => this.delete(key)))
            .then(() => {
              console.log(`[IndexedDB Cache] Cleaned up ${itemsToDelete.length} items, freed ${freedSpace} bytes`);
              resolve();
            })
            .catch(reject);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  private async calculateCurrentCacheSize(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();
      
      let totalSize = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const item = cursor.value as CacheItem;
          totalSize += item.size;
          cursor.continue();
        } else {
          this.currentCacheSize = totalSize;
          resolve();
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

// SINGLETON INSTANCE FOR GLOBAL USE
export const cacheManager = new IndexedDBCacheManager();