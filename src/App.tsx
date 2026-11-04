import { Suspense, lazy } from 'react';
import { useApp } from './store';
import { Home } from './screens/Home';
import { Scan } from './screens/Scan';
import { Assemble } from './screens/Assemble';
import { Build } from './screens/Build';

const Studio = lazy(() => import('./screens/Studio'));

export function App() {
  const screen = useApp((s) => s.screen);
  return (
    <div className="app">
      {screen === 'home' && <Home />}
      {screen === 'scan' && <Scan />}
      {screen === 'assemble' && <Assemble />}
      {screen === 'build' && <Build />}
      {screen === 'studio' && (
        <Suspense fallback={<div className="center muted">Loading 3D studio…</div>}>
          <Studio />
        </Suspense>
      )}
    </div>
  );
}
