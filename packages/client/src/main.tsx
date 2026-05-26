import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionGate } from './components/ConnectionGate';
import { ToastProvider } from './components/Toast';
import 'katex/dist/katex.min.css';
import './index.css';

// Force dark mode always — no light mode support.
document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <script dangerouslySetInnerHTML={{
        __html: `
          const savedHsl = localStorage.getItem('berry-theme-hsl');
          if (savedHsl) {
            document.documentElement.style.setProperty('--theme-primary-hsl', savedHsl);
          }
        `
      }} />
      <ConnectionGate />
    </ToastProvider>
  </React.StrictMode>,
);
