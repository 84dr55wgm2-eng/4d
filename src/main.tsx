import { createRoot } from 'react-dom/client';
import { Studio } from './runtime/Studio';
import { App } from './ui/App';
import './ui/styles.css';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const studio = new Studio(canvas);
// Deterministic operation layer for automation / future AI orchestration.
(window as unknown as { studio: Studio }).studio = studio;
createRoot(document.getElementById('root')!).render(<App studio={studio} />);
studio.boot();
