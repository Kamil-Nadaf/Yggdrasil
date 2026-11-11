import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import UpdatePrompt from './UpdatePrompt';
import Launcher, { isNativeShell } from './Launcher';
import { getState } from './store';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/im-fell-english/latin-400.css';
import '@fontsource/special-elite/latin-400.css';
import './styles.css';
import { startTheme } from './theme';

startTheme();

createRoot(document.getElementById('root')!).render(<StrictMode>{isNativeShell() && (getState().settings.mode !== 'local' || new URLSearchParams(location.search).has('change')) ? <Launcher /> : <><App /><UpdatePrompt /></>}</StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell()) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
