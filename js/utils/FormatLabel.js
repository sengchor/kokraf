export const IS_MAC = (() => {
  const p = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(p);
})();

export function isPrimaryMod(event) {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

function keyFromEvent(event) {
  if (event.altKey && event.code) {
    if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase();
    if (event.code.startsWith('Digit')) return event.code.slice(5);
  }
  return event.key.toLowerCase();
}

export function buildCombo(event) {
  const parts = [];
  if (isPrimaryMod(event)) parts.push('ctrl');
  if (IS_MAC && event.ctrlKey) parts.push('control');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(keyFromEvent(event));
  return parts.join('+');
}

export function matchesShortcut(event, shortcutStr) {
  if (!shortcutStr) return false;
  return buildCombo(event) === shortcutStr.toLowerCase();
}

const MAC_SYMBOLS = { control: '⌃', alt: '⌥', shift: '⇧', ctrl: '⌘' };
const MAC_ORDER = ['control', 'alt', 'shift', 'ctrl'];

export function formatComboLabel(combo, style = 'upper') {
  if (!combo) return '';
  const parts = combo.split('+');

  if (IS_MAC) {
    const mods = MAC_ORDER.filter(m => parts.includes(m)).map(m => MAC_SYMBOLS[m]);
    const keys = parts.filter(p => !MAC_SYMBOLS[p]).map(p => p.toUpperCase());
    return [...mods, ...keys].join(' ');
  }

  return parts
    .map(p => style === 'upper' ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))
    .join(style === 'upper' ? '+' : ' ');
}

export function formatKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}