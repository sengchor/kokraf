export function formatKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

export function buildCombo(event) {
  const parts = [];
  if (event.ctrlKey)  parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey)   parts.push('alt');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

export function matchesShortcut(event, shortcutStr) {
  if (!shortcutStr) return false;
  return buildCombo(event) === shortcutStr.toLowerCase();
}

export function formatComboLabel(combo, style = 'upper') {
  if (!combo) return '';
  return combo
    .split('+')
    .map(p => style === 'upper'
      ? p.toUpperCase()
      : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join(style === 'upper' ? '+' : ' ');
}