// Modelo de reporte (bloques) → HTML imprimible (para PDF vía printToPDF).
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fontFace() {
  const dir = path.join(__dirname, '..', '..', 'node_modules', '@fontsource');
  const f = (fam, pkg, w) => `@font-face{font-family:'${fam}';font-weight:${w};src:url('${pathToFileURL(path.join(dir, pkg, 'files', `${pkg}-latin-${w}-normal.woff2`)).href}') format('woff2');}`;
  return [400, 500, 600, 700].map((w) => f('Barlow', 'barlow', w)).join('') +
    [400, 600].map((w) => f('Barlow Semi Condensed', 'barlow-semi-condensed', w)).join('');
}

function block(b) {
  switch (b.t) {
    case 'h1': return `<h1>${esc(b.text)}</h1>`;
    case 'h2': return `<h2>${esc(b.text)}</h2>`;
    case 'h3': return `<h3>${esc(b.text)}</h3>`;
    case 'p': return `<p>${esc(b.text)}</p>`;
    case 'eq': return `<p class="eq">${esc(b.text)}</p>`;
    case 'note': return `<div class="note ${b.kind || ''}">${esc(b.text)}</div>`;
    case 'list': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'kv':
      return `<table class="kv">${b.rows.map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td>${r[2] !== undefined ? `<td class="ref">${esc(r[2])}</td>` : ''}</tr>`).join('')}</table>`;
    case 'table':
      return `<figure class="tbl">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}<table class="grid"><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 ? 'l' : 'n'}">${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></figure>`;
    case 'img':
      return `<figure class="img"><img src="${b.data}" style="width:${b.w || 6.5}in"/>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    case 'pagebreak': return '<div class="pb"></div>';
    default: return '';
  }
}

function buildHtml(model) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(model.title)}</title><style>
${fontFace()}
@page{size:Letter;}
*{box-sizing:border-box}
body{font-family:'Barlow',sans-serif;color:#1C2A33;font-size:10pt;line-height:1.45;margin:0}
.cover{border-left:6px solid #1F5FA8;padding:4px 0 4px 18px;margin:0 0 22px}
.cover .t{font-size:22pt;font-weight:700;line-height:1.1;margin:0}
.cover .s{font-size:11pt;color:#4A5A63;margin-top:6px}
.meta{width:100%;border-collapse:collapse;margin:8px 0 18px}
.meta td{padding:3px 8px;border-bottom:1px solid #D5DCDE;font-size:9.5pt}
.meta td:first-child{color:#4A5A63;width:32%}
h1{font-size:14pt;color:#1F5FA8;border-bottom:2px solid #1F5FA8;padding-bottom:3px;margin:20px 0 8px;break-after:avoid}
h2{font-size:11.5pt;margin:14px 0 6px;break-after:avoid}
h3{font-size:10.5pt;margin:10px 0 4px;color:#4A5A63;break-after:avoid}
p{margin:4px 0 6px}
.eq{font-family:'Barlow Semi Condensed',sans-serif;background:#F1F4F5;padding:4px 10px;border-left:3px solid #9AA9AE}
ul{margin:4px 0 8px 18px;padding:0}
.note{border-left:4px solid #C9A400;background:#FFF9D6;padding:6px 10px;margin:6px 0;font-size:9.5pt}
.note.warn{border-color:#C8102E;background:#FBE9EC}
table.kv{border-collapse:collapse;width:100%;margin:4px 0 8px}
table.kv th{text-align:left;font-weight:500;color:#4A5A63;padding:2px 8px 2px 0;width:46%;border-bottom:1px solid #E3E8EA}
table.kv td{padding:2px 8px;border-bottom:1px solid #E3E8EA;font-family:'Barlow Semi Condensed',sans-serif;font-variant-numeric:tabular-nums}
table.kv td.ref{color:#6A7A82;font-size:8.5pt;font-family:'Barlow',sans-serif}
figure{margin:8px 0 12px;break-inside:avoid}
figcaption{font-size:8.5pt;color:#4A5A63;margin:3px 0}
table.grid{border-collapse:collapse;width:100%;font-family:'Barlow Semi Condensed',sans-serif;font-size:8.8pt;font-variant-numeric:tabular-nums}
table.grid th{background:#1F5FA8;color:#fff;font-weight:600;padding:3px 5px;text-align:center}
table.grid td{padding:2px 5px;border-bottom:1px solid #DDE3E5}
table.grid td.n{text-align:right}
table.grid tr:nth-child(even) td{background:#F5F7F8}
figure.img{text-align:center}
figure.img img{border:1px solid #D5DCDE}
.pb{break-after:page}
.sign{margin-top:40px;display:flex;gap:40px}
.sign div{flex:1;border-top:1px solid #1C2A33;padding-top:4px;font-size:9pt;color:#4A5A63}
</style></head><body>
<div class="cover"><p class="t">${esc(model.title)}</p><p class="s">${esc(model.subtitle || '')}</p></div>
<table class="meta">${(model.meta || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${model.blocks.map(block).join('\n')}
<div class="sign"><div>Elaborado por: ${esc(model.engineer || '')}</div><div>Idoneidad: ${esc(model.license || '')}</div><div>Fecha: ${esc(model.date || '')}</div></div>
</body></html>`;
}

module.exports = { buildHtml };
