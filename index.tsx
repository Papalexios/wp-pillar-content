import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './src/App';

// Performance monitoring
import { onCLS, onFID, onFCP, onLCP, onTTFB } from 'web-vitals';

// Log performance metrics
onCLS(console.log);
onFID(console.log);
onFCP(console.log);
onLCP(console.log);
onTTFB(console.log);

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);