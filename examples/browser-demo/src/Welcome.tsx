/**
 * Welcome.tsx — Solid landing page matching the Angular welcome design.
 * Modern dark/light, GSAP entrance, live store proxy + jsondb demo, navigation tiles.
 * Uses createSolidStore + proxy API (store.user.name = 'x', store.user.name()) + jsondb DSL.
 */
import { createSignal, createMemo, For, onCleanup, onMount } from 'solid-js';
import { createSolidStore, onSolidDevAction } from 'store-solid';
import 'store-solid/jsondb';
import where from '@synestiqx/jsondb/operators/where';
import update from '@synestiqx/jsondb/operators/update';
import insert from '@synestiqx/jsondb/operators/insert';
import gsap from 'gsap';

interface WelcomeData {
  app: { name: string; version: string; tagline: string; visits: number };
  user: { name: string; role: string; online: boolean };
  stats: { stores: number; operators: number; testCoverage: number };
  [key: string]: unknown;
}

const TILES = [
  { label: 'Live Demo', desc: 'Interactive store + jsondb playground', action: 'demo', icon: '⚡', accent: '#6366f1' },
  { label: 'Nestable CMS', desc: 'Nested tree with jsondb mutations', action: 'nestable', icon: '🧬', accent: '#a855f7' },
  { label: 'Benchmarks', desc: 'Native vs Store vs jsondb engines', action: 'bench', icon: '📊', accent: '#ef4444' },
  { label: 'JsonDB Tests', desc: 'Full test coverage scenarios', action: 'tests', icon: '🧪', accent: '#8b5cf6' },
];

export default function Welcome() {
  const [isDark, setIsDark] = createSignal(true);
  const [logEntries, setLogEntries] = createSignal<string[]>([]);
  const [visits, setVisits] = createSignal(0);

  let store = createSolidStore<WelcomeData>(
    {
      app: { name: 'Reactive Store Engine', version: 'v2.0', tagline: 'Dual-host · Solid + Angular', visits: 0 },
      user: { name: 'Developer', role: 'admin', online: true },
      stats: { stores: 2, operators: 16, testCoverage: 95 },
    },
    'solid_welcome',
  );

  const proxy = store.store as any;
  let rootRef: HTMLDivElement | undefined;
  let demoEl: HTMLElement | undefined;
  let logTimer: ReturnType<typeof setInterval> | undefined;
  let visitTimer: ReturnType<typeof setInterval> | undefined;

  const appTitle = createMemo(() => 'Reactive');
  const appTagline = createMemo(() => 'Store Engine');

  const addLog = (entry: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogEntries(prev => [`[${ts}] ${entry}`, ...prev].slice(0, 20));
  };

  const proxySnippet = createMemo(() =>
`// Create store — proxy returns reactive tree
const store = createSolidStore({
  app: { name: 'Engine', visits: 0 },
  user: { name: 'Dev', role: 'admin' },
  stats: { stores: 2 }
});

// Proxy write (triggers fine-grained wake)
store.user.name = 'Alice';
store.stats.stores = 3;

// Proxy read (callable for reactivity)
store.user.name();       // → 'Alice'
store.stats.stores();    // → 3

// JsonDB DSL mutate
store.mutate(
  where('role', '===', 'admin'),
  update('name', n => n + ' ★')
);`);

  onMount(() => {
    // GSAP staggered entrance — matching Angular welcome
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.hero-badge', { y: 20, opacity: 0, duration: 0.6 })
      .from('.title-line', { y: 40, opacity: 0, duration: 0.8 }, '-=0.3')
      .from('.title-gradient', { y: 40, opacity: 0, duration: 0.8 }, '-=0.6')
      .from('.hero-sub', { y: 20, opacity: 0, duration: 0.6 }, '-=0.4')
      .from('.stat', { y: 30, opacity: 0, duration: 0.5, stagger: 0.1 }, '-=0.3')
      .from('.demo-panel', { y: 40, opacity: 0, duration: 0.6, stagger: 0.15 }, '-=0.2')
      .from('.tile', { y: 50, opacity: 0, duration: 0.5, stagger: 0.08 }, '-=0.2')
      .from('.footer', { opacity: 0, duration: 0.6 }, '-=0.3');

    // Live visit counter via store proxy — demonstrates reactivity
    visitTimer = setInterval(() => {
      const cur = proxy.app.visits() as number;
      proxy.app.visits = cur + 1;
      setVisits(cur + 1);
    }, 3000);
  });

  onCleanup(() => {
    if (visitTimer) clearInterval(visitTimer);
    if (logTimer) clearInterval(logTimer);
    store.destroy();
  });

  const toggleTheme = () => setIsDark(v => !v);

  const runProxyWrite = () => {
    const names = ['Developer', 'Alice', 'Bob', 'Carol', 'Dan'];
    const roles = ['admin', 'editor', 'viewer', 'maintainer'];
    const next = names[Math.floor(Math.random() * names.length)];
    const nextRole = roles[Math.floor(Math.random() * roles.length)];
    proxy.user.name = next;
    proxy.user.role = nextRole;
    proxy.stats.stores = (proxy.stats.stores() as number) + 1;
    addLog(`proxy: user.name = "${next}", user.role = "${nextRole}"`);
  };

  const runJsondbMutate = () => {
    proxy.mutate(
      where('role', '===', proxy.user.role()),
      update('name', (cur: string) => cur + ' ✦'),
    );
    addLog(`jsondb: where(role===${proxy.user.role()}) → update(name + "✦")`);
  };

  const runInsert = () => {
    proxy.mutate(insert({ id: Date.now(), label: 'moved item' }, 'inside'));
    addLog(`jsondb: insert({id:${Date.now()}}) → inside root`);
  };

  const resetDemo = () => {
    store.destroy();
    store = createSolidStore<WelcomeData>(
      {
        app: { name: 'Reactive Store Engine', version: 'v2.0', tagline: 'Dual-host · Solid + Angular', visits: 0 },
        user: { name: 'Developer', role: 'admin', online: true },
        stats: { stores: 2, operators: 16, testCoverage: 95 },
      },
      'solid_welcome',
    );
    setLogEntries([]);
    addLog('store reset to initial state');
  };

  const navigate = (action: string) => {
    // Dispatch a custom event so the host (index.tsx) can swap to the demo view
    window.dispatchEvent(new CustomEvent('welcome-navigate', { detail: action }));
  };

  return (
    <div class="welcome-root" classList={{ dark: isDark(), light: !isDark() }} ref={rootRef}>
      {/* Animated gradient background */}
      <div class="bg-orbs">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>

      {/* Theme toggle */}
      <button class="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
        <span classList={{ 'theme-icon sun': isDark(), 'theme-icon moon': !isDark() }}>
          {isDark() ? '☀' : '☾'}
        </span>
      </button>

      {/* Hero */}
      <section class="hero">
        <div class="hero-badge">
          <span class="badge-dot"></span>
          <span>Reactive Store Engine · Dual-Host (Solid + Angular)</span>
        </div>
        <h1 class="hero-title">
          <span class="title-line">{appTitle()}</span>
          <span class="title-gradient">{appTagline()}</span>
        </h1>
        <p class="hero-sub">
          A high-performance reactive store with a JSON query DSL, proxy-based access,
          copy-on-write mutations, and fine-grained reactivity. Same engine, two runtimes.
        </p>
        <div class="hero-stats">
          <div class="stat">
            <span class="stat-num">{proxy.stats.stores()}</span>
            <span class="stat-label">Active Stores</span>
          </div>
          <div class="stat">
            <span class="stat-num">{proxy.stats.operators()}</span>
            <span class="stat-label">JsonDB Operators</span>
          </div>
          <div class="stat">
            <span class="stat-num">{proxy.stats.testCoverage()}<small>%</small></span>
            <span class="stat-label">Test Coverage</span>
          </div>
          <div class="stat">
            <span class="stat-num pulse">{visits()}</span>
            <span class="stat-label">Live Visits</span>
          </div>
        </div>
      </section>

      {/* Live store demo */}
      <section class="live-demo" ref={demoEl}>
        <div class="demo-header">
          <h2>Live Proxy + JsonDB Demo</h2>
          <span class="demo-pulse">● live</span>
        </div>
        <div class="demo-grid">
          <div class="demo-panel demo-code">
            <h3>Proxy API</h3>
            <pre><code>{proxySnippet()}</code></pre>
            <div class="demo-actions">
              <button onClick={runProxyWrite}>Write via proxy</button>
              <button onClick={runJsondbMutate}>Mutate via JsonDB</button>
              <button onClick={runInsert}>Insert via JsonDB</button>
              <button onClick={resetDemo}>Reset</button>
            </div>
          </div>
          <div class="demo-panel demo-state">
            <h3>Store State (reactive read)</h3>
            <div class="state-readout">
              <div class="state-row">
                <span class="state-key">app.name</span>
                <span class="state-val">{proxy.app.name()}</span>
              </div>
              <div class="state-row">
                <span class="state-key">user.name</span>
                <span class="state-val">{proxy.user.name()}</span>
              </div>
              <div class="state-row">
                <span class="state-key">user.role</span>
                <span class="state-val">{proxy.user.role()}</span>
              </div>
              <div class="state-row">
                <span class="state-key">stats.stores</span>
                <span class="state-val">{proxy.stats.stores()}</span>
              </div>
              <div class="state-row">
                <span class="state-key">app.visits</span>
                <span class="state-val pulse">{visits()}</span>
              </div>
            </div>
            <div class="log-panel">
              <h4>JsonDB operations log</h4>
              <div class="log-entries">
                <For each={logEntries()}>
                  {(entry) => <div class="log-entry">{entry}</div>}
                </For>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Navigation tiles */}
      <section class="tiles">
        <h2 class="tiles-title">Explore</h2>
        <div class="tiles-grid">
          <For each={TILES}>
            {(tile) => (
              <a
                class="tile"
                style={{ '--accent': tile.accent }}
                onClick={() => navigate(tile.action)}
              >
                <div class="tile-icon">{tile.icon}</div>
                <div class="tile-body">
                  <span class="tile-label">{tile.label}</span>
                  <span class="tile-desc">{tile.desc}</span>
                </div>
                <div class="tile-arrow">→</div>
              </a>
            )}
          </For>
        </div>
      </section>

      <footer class="footer">
        <span>Built with the store engine · v2.0</span>
        <span>Solid · Angular · JsonDB</span>
      </footer>
    </div>
  );
}
