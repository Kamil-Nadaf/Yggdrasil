import { getState, subscribe, type ThemeName } from './store';

export const THEMES: { id: ThemeName; name: string; bg: string; surface: string; ink: string; accent: string; meta: string }[] = [
  { id: 'dark', name: 'Dark', bg: '#0F0F10', surface: '#17171A', ink: '#ECECEC', accent: '#7FD6A4', meta: '#0F0F10' },
  { id: 'light', name: 'Light', bg: '#F6F6F3', surface: '#FFFFFF', ink: '#1B1B1D', accent: '#2E8B57', meta: '#F6F6F3' },
  { id: 'paper', name: 'Paper', bg: '#FAFAF8', surface: '#F5F5F2', ink: '#1A1A1A', accent: '#000000', meta: '#FAFAF8' },
  { id: 'notebook', name: 'Notebook', bg: '#F3E5C3', surface: '#F9EFD6', ink: '#2A1F3D', accent: '#5B3F8C', meta: '#F3E5C3' },
];
export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Theme default', value: '' },
  { name: 'Green', value: '#3FA66B' }, { name: 'Blue', value: '#4A7BD0' }, { name: 'Amber', value: '#D08A2E' },
  { name: 'Rose', value: '#D2566B' }, { name: 'Violet', value: '#8B6BD6' }, { name: 'Teal', value: '#2A9D9A' },
];

const onAccent = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#10140F' : '#FFFFFF';
};

export function applyTheme() {
  const { theme, accent } = getState().settings;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.fontSize = `${getState().settings.textScale || 100}%`;
  if (accent && theme !== 'paper') { root.style.setProperty('--accent', accent); root.style.setProperty('--on-accent', theme === 'notebook' && onAccent(accent) === '#FFFFFF' ? '#fbf3e4' : onAccent(accent)); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--on-accent'); }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEMES.find((t) => t.id === theme)?.meta || '#0F0F10');
}
export function startTheme() { applyTheme(); subscribe(applyTheme); }
