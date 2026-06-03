import { render } from 'solid-js/web';
import App from './App';
import './styles/reset.css';
import './styles/tokens.css';
import './styles/type.css';
import './styles/sr-only.css';
import './styles/skip-link.css';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

render(() => <App />, root);
