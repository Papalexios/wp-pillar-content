// Service Worker for Offline Functionality and Background Sync
const CACHE_NAME = 'wp-content-optimizer-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing Service Worker');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating Service Worker');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests differently
  if (url.pathname.includes('/api/')) {
    event.respondWith(handleApiRequest(request));
  }
  // Handle static assets
  else if (STATIC_ASSETS.some(asset => url.pathname === asset)) {
    event.respondWith(handleStaticRequest(request));
  }
  // Handle dynamic content
  else {
    event.respondWith(handleDynamicRequest(request));
  }
});

// Handle API requests - cache with TTL
async function handleApiRequest(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  // Check if cached response is still valid (5 minutes TTL)
  if (cachedResponse) {
    const cachedTime = cachedResponse.headers.get('cached-time');
    if (cachedTime && Date.now() - parseInt(cachedTime) < 5 * 60 * 1000) {
      console.log('[SW] Serving API from cache:', request.url);
      return cachedResponse;
    }
  }
  
  try {
    console.log('[SW] Fetching API from network:', request.url);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Clone and add cache timestamp
      const responseToCache = networkResponse.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('cached-time', Date.now().toString());
      
      const cachedResponse = new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers
      });
      
      await cache.put(request, cachedResponse);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, serving stale cache:', request.url);
    return cachedResponse || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle static requests - cache first
async function handleStaticRequest(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Serving static from cache:', request.url);
    return cachedResponse;
  }
  
  try {
    console.log('[SW] Fetching static from network:', request.url);
    const networkResponse = await fetch(request);
    await cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    console.log('[SW] Static request failed:', request.url);
    return new Response('Offline', { status: 503 });
  }
}

// Handle dynamic requests - network first with cache fallback
async function handleDynamicRequest(request) {
  try {
    console.log('[SW] Fetching dynamic from network:', request.url);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    return cachedResponse || new Response('Offline', { status: 503 });
  }
}

// Background sync for failed requests
self.addEventListener('sync', event => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'background-content-generation') {
    event.waitUntil(handleBackgroundContentGeneration());
  }
});

// Handle background content generation
async function handleBackgroundContentGeneration() {
  console.log('[SW] Processing background content generation');
  
  try {
    // Get pending requests from IndexedDB
    const pendingRequests = await getPendingRequests();
    
    for (const request of pendingRequests) {
      try {
        const response = await fetch(request.url, request.options);
        if (response.ok) {
          await removePendingRequest(request.id);
          
          // Notify client of completion
          const clients = await self.clients.matchAll();
          clients.forEach(client => {
            client.postMessage({
              type: 'BACKGROUND_SYNC_COMPLETE',
              data: { requestId: request.id, success: true }
            });
          });
        }
      } catch (error) {
        console.error('[SW] Background request failed:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Background sync error:', error);
  }
}

// IndexedDB helpers for background sync
async function getPendingRequests() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wp-content-optimizer-sync', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pending'], 'readonly');
      const store = transaction.objectStore('pending');
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
      getAllRequest.onerror = () => reject(getAllRequest.error);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending')) {
        const store = db.createObjectStore('pending', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

async function removePendingRequest(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wp-content-optimizer-sync', 1);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pending'], 'readwrite');
      const store = transaction.objectStore('pending');
      const deleteRequest = store.delete(id);
      
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
  });
}

// Push notifications for content generation completion
self.addEventListener('push', event => {
  console.log('[SW] Push notification received');
  
  const options = {
    body: 'Your content generation is complete!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: event.data ? event.data.json() : {},
    actions: [
      {
        action: 'view',
        title: 'View Content',
        icon: '/favicon.ico'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('WP Content Optimizer', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/content-hub')
    );
  }
});