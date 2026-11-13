import React from 'react';
import ReactDOM from 'react-dom/client';
import { PetCanvas } from './PetCanvas';
import '@/styles/index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PetCanvas />
    </React.StrictMode>
  );
}
