import { createRoot } from 'react-dom/client';
import { SafeDemo } from './components/SafeDemo';

const element = document.getElementById('root');
if (element) createRoot(element).render(<SafeDemo />);