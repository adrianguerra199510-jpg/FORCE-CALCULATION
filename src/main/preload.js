const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readData: (rel) => ipcRenderer.invoke('data:read', rel),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  exportDocx: (model) => ipcRenderer.invoke('report:docx', model),
  exportPdf: (model) => ipcRenderer.invoke('report:pdf', model),
  reportHtml: (model) => ipcRenderer.invoke('report:html', model),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  version: () => ipcRenderer.invoke('app:version'),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, ch) => fn(ch)),
  selftest: {
    config: () => ipcRenderer.invoke('selftest:config'),
    capture: (name) => ipcRenderer.invoke('selftest:capture', name),
    log: (msg) => ipcRenderer.invoke('selftest:log', msg),
    done: () => ipcRenderer.invoke('selftest:done'),
  },
});
