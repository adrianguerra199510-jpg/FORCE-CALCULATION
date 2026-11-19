// Modelo de reporte (bloques) → documento Word (.docx) con la librería docx.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, HeadingLevel,
  AlignmentType, WidthType, BorderStyle, ShadingType, Footer, PageNumber, TableLayoutType,
} = require('docx');

const BLUE = '1F5FA8';
const INK = '1C2A33';
const MUTED = '4A5A63';
const FONT = 'Calibri';
const PAGE_W_IN = 6.5;

function dataUrlToBuffer(d) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/.exec(d);
  if (!m) throw new Error('Imagen inválida en el reporte');
  return { type: m[1] === 'png' ? 'png' : 'jpg', buf: Buffer.from(m[2], 'base64') };
}

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'D5DCDE' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function cell(text, { header = false, right = false, width, shade, color, size = 17, bold } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: BLUE } : shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
    margins: { top: 30, bottom: 30, left: 70, right: 70 },
    borders: { top: thin, bottom: thin, left: none, right: none },
    children: [
      new Paragraph({
        alignment: header ? AlignmentType.CENTER : right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: String(text ?? ''), bold: bold ?? header, color: header ? 'FFFFFF' : color || INK, size, font: FONT })],
      }),
    ],
  });
}

function caption(text) {
  return new Paragraph({ spacing: { before: 60, after: 160 }, children: [new TextRun({ text, italics: true, size: 16, color: MUTED, font: FONT })] });
}

function blockToDocx(b) {
  switch (b.t) {
    case 'h1': return [new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 2 } }, children: [new TextRun({ text: b.text, bold: true, size: 28, color: BLUE, font: FONT })] })];
    case 'h2': return [new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 }, children: [new TextRun({ text: b.text, bold: true, size: 23, color: INK, font: FONT })] })];
    case 'h3': return [new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: b.text, bold: true, size: 21, color: MUTED, font: FONT })] })];
    case 'p': return [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: b.text, size: 20, font: FONT, color: INK })] })];
    case 'eq': return [new Paragraph({ spacing: { after: 100 }, indent: { left: 240 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F4F5' }, children: [new TextRun({ text: b.text, size: 20, font: 'Cambria Math', color: INK })] })];
    case 'note': return [new Paragraph({
      spacing: { before: 80, after: 80 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: b.kind === 'warn' ? 'FBE9EC' : 'FFF9D6' },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: b.kind === 'warn' ? 'C8102E' : 'C9A400', space: 6 } },
      children: [new TextRun({ text: b.text, size: 19, font: FONT, color: INK })],
    })];
    case 'list': return b.items.map((i) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: i, size: 20, font: FONT, color: INK })] }));
    case 'kv': {
      const hasRef = b.rows.some((r) => r[2] !== undefined);
      return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: b.rows.map((r) => new TableRow({
          children: [
            cell(r[0], { width: hasRef ? 44 : 55, color: MUTED, size: 19 }),
            cell(r[1], { width: hasRef ? 28 : 45, size: 19, bold: true }),
            ...(hasRef ? [cell(r[2] ?? '', { width: 28, color: '6A7A82', size: 16 })] : []),
          ],
        })),
      }), new Paragraph({ spacing: { after: 80 }, children: [] })];
    }
    case 'table': {
      const out = [];
      if (b.caption) out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: b.caption, bold: true, size: 18, color: MUTED, font: FONT })] }));
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: b.head.map((h) => cell(h, { header: true })) }),
          ...b.rows.map((r, k) => new TableRow({ children: r.map((c, i) => cell(c, { right: i > 0, shade: k % 2 ? 'F5F7F8' : undefined })) })),
        ],
      }));
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      return out;
    }
    case 'img': {
      const { type, buf } = dataUrlToBuffer(b.data);
      const wIn = Math.min(b.w || PAGE_W_IN, PAGE_W_IN);
      const ratio = b.ratio || 0.6;
      const out = [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120 },
        children: [new ImageRun({ type, data: buf, transformation: { width: Math.round(wIn * 96), height: Math.round(wIn * 96 * ratio) } })],
      })];
      if (b.caption) out.push(caption(b.caption));
      return out;
    }
    case 'pagebreak': return [new Paragraph({ pageBreakBefore: true, children: [] })];
    default: return [];
  }
}

async function buildDocx(model) {
  const cover = [
    new Paragraph({ spacing: { after: 60 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: BLUE, space: 10 } }, children: [new TextRun({ text: model.title, bold: true, size: 44, color: INK, font: FONT })] }),
    new Paragraph({ spacing: { after: 240 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: BLUE, space: 10 } }, children: [new TextRun({ text: model.subtitle || '', size: 22, color: MUTED, font: FONT })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: (model.meta || []).map(([k, v]) => new TableRow({ children: [cell(k, { width: 32, color: MUTED, size: 19 }), cell(v, { width: 68, size: 19 })] })),
    }),
  ];
  const body = model.blocks.flatMap(blockToDocx);
  const sign = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [`Elaborado por: ${model.engineer || ''}`, `Idoneidad: ${model.license || ''}`, `Fecha: ${model.date || ''}`].map((t) => new TableCell({
        borders: { top: { style: BorderStyle.SINGLE, size: 8, color: INK }, bottom: none, left: none, right: none },
        margins: { top: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: t, size: 18, color: MUTED, font: FONT })] })],
      })),
    })],
  });
  const doc = new Document({
    creator: 'Force Calculation REP-2021',
    title: model.title,
    description: model.subtitle,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1080, right: 1080 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `${model.title} — REP-2021    Página `, size: 16, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED, font: FONT }),
              new TextRun({ text: ' de ', size: 16, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED, font: FONT }),
            ],
          })],
        }),
      },
      children: [...cover, ...body, new Paragraph({ spacing: { before: 600 }, children: [] }), sign],
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx };
