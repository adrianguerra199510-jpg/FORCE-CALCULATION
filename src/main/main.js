// Proceso principal de Electron.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildDocx } = require('../report/docx');
const { buildHtml } = require('../report/html');

const ROOT = path.join(__dirname, '..');
const SELFTEST_DIR = process.env.FC_SELFTEST || null; // modo de autoprueba (CI / verificación)
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: `Force Calculation · REP-2021 · v${app.getVersion()}`,
    backgroundColor: '#E9EEEC',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    const msg = `[renderer] ${message} (${source}:${line})`;
    if (SELFTEST_DIR) fs.appendFileSync(path.join(SELFTEST_DIR, 'console.log'), msg + '\n');
    else if (level >= 2) console.log(msg);
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

function menuTemplate() {
  const send = (ch) => () => win && win.webContents.send('menu', ch);
  return [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo proyecto', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Exportar reporte Word…', click: send('docx') },
        { label: 'Exportar reporte PDF…', click: send('pdf') },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Ayuda', submenu: [{ label: 'Acerca de', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Force Calculation', message: `Force Calculation · REP-2021 · versión ${app.getVersion()}`, detail: 'Cálculo de cargas de viento y sismo según el Reglamento de Diseño Estructural de Panamá REP-2021 (ASCE/SEI 7-05).\n\nLos resultados deben ser revisados por un ingeniero idóneo.' }) }] },
  ];
}

// ---------------------------------------------------------------- IPC: datos
ipcMain.handle('data:read', (_e, rel) => {
  const p = path.normalize(path.join(ROOT, 'data', rel));
  if (!p.startsWith(path.join(ROOT, 'data'))) throw new Error('Ruta no permitida');
  return fs.readFileSync(p, 'utf8');
});

// ---------------------------------------------------------------- IPC: proyecto
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir proyecto',
    filters: [{ name: 'Proyecto Force Calculation', extensions: ['fcp', 'json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('project:save', async (_e, { content, filePath, suggestedName }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Guardar proyecto',
      defaultPath: (suggestedName || 'proyecto') + '.fcp',
      filters: [{ name: 'Proyecto Force Calculation', extensions: ['fcp'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, content, 'utf8');
  return target;
});

// ---------------------------------------------------------------- IPC: reportes
async function askTarget(title, name, ext, label) {
  if (SELFTEST_DIR) return path.join(SELFTEST_DIR, `${name}.${ext}`);
  const r = await dialog.showSaveDialog(win, { title, defaultPath: `${name}.${ext}`, filters: [{ name: label, extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
}

ipcMain.handle('report:docx', async (_e, model) => {
  const target = await askTarget('Exportar reporte Word', model.fileName, 'docx', 'Documento de Word');
  if (!target) return null;
  const buf = await buildDocx(model);
  fs.writeFileSync(target, buf);
  return target;
});

ipcMain.handle('report:pdf', async (_e, model) => {
  const target = await askTarget('Exportar reporte PDF', model.fileName, 'pdf', 'Documento PDF');
  if (!target) return null;
  const html = buildHtml(model);
  const tmp = path.join(app.getPath('temp'), `fc-report-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await pw.loadFile(tmp);
    const pdf = await pw.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.7in;color:#555;display:flex;justify-content:space-between;font-family:sans-serif"><span>${escapeHtml(model.title)} — REP-2021</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    });
    fs.writeFileSync(target, pdf);
  } finally {
    pw.destroy();
    fs.rmSync(tmp, { force: true });
  }
  return target;
});

ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('app:version', () => app.getVersion());

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- IPC: autoprueba
ipcMain.handle('selftest:config', () => (SELFTEST_DIR ? { dir: SELFTEST_DIR } : null));
ipcMain.handle('selftest:capture', async (_e, name) => {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SELFTEST_DIR, `${name}.png`), img.toPNG());
  return true;
});
ipcMain.handle('selftest:log', (_e, msg) => {
  fs.appendFileSync(path.join(SELFTEST_DIR, 'selftest.log'), msg + '\n');
});
ipcMain.handle('selftest:done', () => {
  setTimeout(() => app.quit(), 200);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
