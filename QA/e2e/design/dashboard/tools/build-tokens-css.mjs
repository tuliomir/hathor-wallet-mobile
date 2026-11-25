// Compiles design-system/tokens.json into design-system/tokens.css, the same
// shape the design-system page generates: theme blocks for colours, :root for
// the other families and the font stacks, one class per type style.
// Usage: node QA/e2e/design/dashboard/tools/build-tokens-css.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design-system');
const t = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
const themes = t.color.themes.map((x) => x.id);
const first = themes[0];
const val = (tok, theme) => {
  const v = typeof tok.value === 'string' ? tok.value : (tok.value[theme] ?? tok.value[first]);
  return /^\{.+\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v;
};
const out = [`/* ${t.name} — generated from tokens.json by tools/build-tokens-css.mjs; do not edit */`];
themes.forEach((th, i) => {
  const sel = i === 0 ? `:root, [data-theme="${th}"]` : `[data-theme="${th}"]`;
  out.push(`${sel} {`, ...t.color.tokens.map((c) => `  --${c.name}: ${val(c, th)};`), '}');
});
const rest = Object.entries(t).filter(([k, v]) => !['color', 'type'].includes(k) && v && Array.isArray(v.tokens));
out.push(':root {');
rest.forEach(([, fam]) => fam.tokens.forEach((x) => out.push(`  --${x.name}: ${x.value};`)));
Object.entries(t.type.families).forEach(([k, v]) => out.push(`  --font-${k}: ${v};`));
out.push('}');
const css = { fontSize: 'font-size', lineHeight: 'line-height', fontWeight: 'font-weight', letterSpacing: 'letter-spacing' };
t.type.groups.forEach((g) => g.styles.forEach((s) => {
  const decl = [`font-family: var(--font-${s.family || g.family})`];
  Object.entries(css).forEach(([k, p]) => { if (s[k] != null) decl.push(`${p}: ${s[k]}`); });
  out.push(`.${s.name} { ${decl.join('; ')}; font-variant-numeric: tabular-nums; }`);
}));
writeFileSync(join(dir, 'tokens.css'), out.join('\n') + '\n');
console.log(`tokens.css: ${t.color.tokens.length} colours × ${themes.length} themes`);
