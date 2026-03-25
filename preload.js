const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importFile: (filePath) => ipcRenderer.invoke('import-file', filePath),
  deleteFile: (slot) => ipcRenderer.invoke('delete-file', slot),
  selectFile: () => ipcRenderer.invoke('select-file'),
  scanFiles: () => ipcRenderer.invoke('scan-files'),
  openStorageDir: () => ipcRenderer.invoke('open-storage-dir'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  upload360: (slot) => ipcRenderer.invoke('upload-360', slot),
  uploadWinSCP: (slot) => ipcRenderer.invoke('upload-winscp', slot),
  uploadWinSCPAll: () => ipcRenderer.invoke('upload-winscp-all'),
  uploadAll: () => ipcRenderer.invoke('upload-all'),
  // 版本管理
  getVersions: () => ipcRenderer.invoke('get-versions'),
  switchVersion: (version) => ipcRenderer.invoke('switch-version', version),
  getCurrentVersion: () => ipcRenderer.invoke('get-current-version'),
  // FTP 拉取
  pullFromFTP: () => ipcRenderer.invoke('pull-from-ftp'),
  // 打开 WinSCP 文档
  openWinSCPDoc: () => ipcRenderer.invoke('open-winscp-doc'),
  // 事件监听
  onLog: (callback) => ipcRenderer.on('log', (event, msg) => callback(msg)),
  onUploadStatus: (callback) => ipcRenderer.on('upload-status', (event, data) => callback(data))
});
