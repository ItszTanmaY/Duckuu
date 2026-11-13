import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatApp } from './ChatApp';
import '@/styles/index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ChatApp />
    </React.StrictMode>
  );
}
