// One source of truth for colour: applied as CSS variables AND sent to the 3D scene.
const dark = { vTrue: '#5be3a4', vFalse: '#ff6b7a', vMixed: '#ffc857', vRelated: '#7db8ff', vNone: '#b3b3c4' };
const light = { vTrue: '#0a8f5c', vFalse: '#d1263b', vMixed: '#a86a00', vRelated: '#1f63c6', vNone: '#5b5b6e' };

export const THEMES = {
  midnight: {
    name: 'Midnight', light: false, swatch: ['#07060d', '#8b5cff', '#ff4fd8'],
    vars: { bg: '#07060d', bg2: '#100c1d', ink: '#f2eefc', muted: '#a8a1c6', line: 'rgba(255,255,255,.14)', card: 'rgba(18,13,34,.62)',
      accent: '#b57bff', accentInk: '#14082a', ...dark },
    scene: { a: '#ff4fd8', b: '#8b5cff', c: '#3aa0ff', clean: '#e8fff7' }
  },
  lagoon: {
    name: 'Lagoon', light: false, swatch: ['#031211', '#2ee6c5', '#22b3ff'],
    vars: { bg: '#031211', bg2: '#08201f', ink: '#e8fffb', muted: '#93bdb7', line: 'rgba(200,255,245,.15)', card: 'rgba(5,32,31,.62)',
      accent: '#2ee6c5', accentInk: '#02211c', ...dark },
    scene: { a: '#2ee6c5', b: '#22b3ff', c: '#b7ff5a', clean: '#ffffff' }
  },
  ember: {
    name: 'Ember', light: false, swatch: ['#0d0705', '#ff7a3d', '#ff2e93'],
    vars: { bg: '#0d0705', bg2: '#1b0f0a', ink: '#fff1e6', muted: '#c7a593', line: 'rgba(255,220,200,.15)', card: 'rgba(33,17,11,.62)',
      accent: '#ff7a3d', accentInk: '#260c02', ...dark },
    scene: { a: '#ff4d2e', b: '#ffb02e', c: '#ff2e93', clean: '#fff6df' }
  },
  paper: {
    name: 'Paper', light: true, swatch: ['#e8e8ec', '#7a2cf0', '#c0238f'],
    vars: { bg: '#e8e8ec', bg2: '#f6f6f9', ink: '#14141c', muted: '#585869', line: 'rgba(20,20,28,.16)', card: 'rgba(255,255,255,.66)',
      accent: '#7a2cf0', accentInk: '#ffffff', ...light },
    scene: { a: '#c0238f', b: '#6a3cf0', c: '#2a7fd6', clean: '#14141c' }
  },
  glacier: {
    name: 'Glacier', light: true, swatch: ['#e3edf6', '#0a6cff', '#00b8d9'],
    vars: { bg: '#e3edf6', bg2: '#f3f8fc', ink: '#0a1a2c', muted: '#46607a', line: 'rgba(10,26,44,.16)', card: 'rgba(255,255,255,.7)',
      accent: '#0a6cff', accentInk: '#ffffff', ...light },
    scene: { a: '#0a6cff', b: '#00b8d9', c: '#6b4cff', clean: '#0a1a2c' }
  }
};

export function resolveTheme(id) {
  if (id === 'auto' || !THEMES[id]) {
    return matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'midnight';
  }
  return id;
}

export function applyTheme(id) {
  const key = resolveTheme(id);
  const t = THEMES[key];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty('--' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v);
  root.dataset.theme = key;
  root.style.colorScheme = t.light ? 'light' : 'dark';
  return t;
}
