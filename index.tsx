import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './src/App';

// Performance monitoring
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';

// Log performance metrics
onCLS(console.log);
onINP(console.log);
onLCP(console.log);
onTTFB(console.log);

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);