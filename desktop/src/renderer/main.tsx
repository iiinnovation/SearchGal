import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

document.body.dataset.window = window.location.hash === '#pet' ? 'pet' : 'panel';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
