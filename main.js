const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const FileManager = require('./src/file-manager');
const Uploader360 = require('./src/uploader-360');
const UploaderWinSCP = require('./src/uploader-winscp');
const FTPPuller = require('./src/ftp-puller');
const KernelSigner = require('./src/kernel-signer');
const Config = require('./src/config');

let mainWindow;
let activeKernelSigner = null;
const config = new Config();
const fileManager = new FileManager(config);

// 迁移旧目录结构
fileManager.migrateOldStructure();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 950,
    title: 'DICloak 上传工具',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('src/index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// IPC: 文件管理
ipcMain.handle('import-file', async (event, filePath) => {
  return fileManager.importFile(filePath);
});

ipcMain.handle('delete-file', async (event, slot) => {
  return fileManager.deleteFile(slot);
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'DICloak 安装包', extensions: ['exe', 'zip', 'dmg'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  return fileManager.importFile(result.filePaths[0]);
});

ipcMain.handle('scan-files', async () => {
  return fileManager.scanAll();
});

ipcMain.handle('open-storage-dir', async () => {
  shell.openPath(config.get('storage_dir'));
});

ipcMain.handle('open-winscp-doc', async () => {
  shell.openExternal('https://wcnjxlemm9cv.feishu.cn/docx/NwIEdeARRoNRwdxWw87coq40n8b');
});

// IPC: 版本管理
ipcMain.handle('get-versions', async () => {
  return fileManager.getVersions();
});

ipcMain.handle('switch-version', async (event, version) => {
  return fileManager.setVersion(version);
});

ipcMain.handle('get-current-version', async () => {
  return fileManager.currentVersion;
});

// IPC: FTP 拉取
ipcMain.handle('pull-from-ftp', async () => {
  const puller = new FTPPuller(config, (msg) => {
    mainWindow.webContents.send('log', msg);
  });

  const existingVersions = fileManager.getVersions();
  const result = await puller.pull(existingVersions);
  if (!result.success) {
    return result;
  }

  // 导入下载的文件到版本目录
  mainWindow.webContents.send('log', '正在导入文件到版本目录...');
  const files = fileManager.importFTPFiles(result.version, result.buildNo, result.downloadedFiles);
  mainWindow.webContents.send('log', `✅ 版本 ${result.version} (构建 #${result.buildNo}) 导入完成`);

  return {
    success: true,
    version: result.version,
    buildNo: result.buildNo,
    files
  };
});

// IPC: 配置
ipcMain.handle('get-config', () => config.getAll());

ipcMain.handle('save-config', (event, data) => {
  config.save(data);
  return { success: true };
});

// IPC: 360上传
ipcMain.handle('upload-360', async (event, slot) => {
  const fileInfo = fileManager.getFile(slot);
  const uploader = new Uploader360(config, (msg) => {
    mainWindow.webContents.send('log', msg);
  });
  return uploader.upload(fileInfo, slot);
});

// IPC: WinSCP上传（单个）
ipcMain.handle('upload-winscp', async (event, slot) => {
  const fileInfo = fileManager.getFile(slot);
  const uploader = new UploaderWinSCP(config, (msg) => {
    mainWindow.webContents.send('log', msg);
  });
  return uploader.upload(fileInfo);
});

// IPC: WinSCP同时上传多个
ipcMain.handle('upload-winscp-all', async () => {
  const slotsWinscp = ['zip-x64', 'zip-ia32'];
  const fileInfos = slotsWinscp.map(s => fileManager.getFile(s)).filter(Boolean);
  if (fileInfos.length === 0) {
    return { success: false, error: '没有 zip 文件' };
  }
  for (const slot of slotsWinscp) {
    if (fileManager.getFile(slot)) {
      mainWindow.webContents.send('upload-status', { slot, status: 'uploading' });
    }
  }
  const uploader = new UploaderWinSCP(config, (msg) => {
    mainWindow.webContents.send('log', msg);
  });
  const result = await uploader.uploadMultiple(fileInfos);
  for (const slot of slotsWinscp) {
    if (fileManager.getFile(slot)) {
      mainWindow.webContents.send('upload-status', {
        slot, status: result.success ? 'success' : 'failed'
      });
    }
  }
  return result;
});

// IPC: 全部上传
ipcMain.handle('upload-all', async () => {
  const slots360 = ['exe-x64', 'exe-ia32'];
  const slotsWinscp = ['zip-x64', 'zip-ia32'];
  const results = {};

  for (const slot of slots360) {
    const fileInfo = fileManager.getFile(slot);
    if (!fileInfo) {
      mainWindow.webContents.send('log', `跳过 ${slot}：没有文件`);
      mainWindow.webContents.send('upload-status', { slot, status: 'skipped' });
      continue;
    }
    mainWindow.webContents.send('upload-status', { slot, status: 'uploading' });
    const uploader = new Uploader360(config, (msg) => {
      mainWindow.webContents.send('log', msg);
    });
    results[slot] = await uploader.upload(fileInfo, slot);
    mainWindow.webContents.send('upload-status', {
      slot,
      status: results[slot].success ? 'success' : 'failed'
    });
  }

  // WinSCP: 同时上传两个 zip 包
  const winscpFiles = slotsWinscp.map(s => fileManager.getFile(s)).filter(Boolean);
  if (winscpFiles.length > 0) {
    for (const slot of slotsWinscp) {
      if (fileManager.getFile(slot)) {
        mainWindow.webContents.send('upload-status', { slot, status: 'uploading' });
      }
    }
    const uploader = new UploaderWinSCP(config, (msg) => {
      mainWindow.webContents.send('log', msg);
    });
    const winscpResult = await uploader.uploadMultiple(winscpFiles);
    for (const slot of slotsWinscp) {
      if (fileManager.getFile(slot)) {
        results[slot] = winscpResult;
        mainWindow.webContents.send('upload-status', {
          slot, status: winscpResult.success ? 'success' : 'failed'
        });
      } else {
        mainWindow.webContents.send('upload-status', { slot, status: 'skipped' });
      }
    }
  } else {
    for (const slot of slotsWinscp) {
      mainWindow.webContents.send('log', `跳过 ${slot}：没有文件`);
      mainWindow.webContents.send('upload-status', { slot, status: 'skipped' });
    }
  }

  return results;
});

// IPC: 内核签名
ipcMain.handle('list-core-files', async () => {
  const signer = new KernelSigner(config, (msg) => {
    mainWindow.webContents.send('kernel-log', msg);
  });
  return signer.listCoreFiles();
});

ipcMain.handle('start-kernel-signing', async (event, selections) => {
  activeKernelSigner = new KernelSigner(
    config,
    (msg) => mainWindow.webContents.send('kernel-log', msg),
    (data) => mainWindow.webContents.send('kernel-progress', data)
  );
  const result = await activeKernelSigner.runPipeline(selections);
  activeKernelSigner = null;
  return result;
});

ipcMain.handle('cancel-kernel-signing', () => {
  if (activeKernelSigner) {
    activeKernelSigner.cancel();
  }
  return { success: true };
});
