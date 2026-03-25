const fs = require('fs');
const path = require('path');
const { parseFileName, getSlot, ALL_SLOTS } = require('./file-parser');

class FileManager {
  constructor(config) {
    this.config = config;
    this.files = {}; // { 'exe-x64': { filePath, fileName, version, arch, type, size, platform } }
    this.currentVersion = null;
  }

  // 获取所有版本列表（从存储目录扫描）
  getVersions() {
    const storageDir = this.config.get('storage_dir');
    const versions = [];

    if (!fs.existsSync(storageDir)) return versions;

    for (const entry of fs.readdirSync(storageDir)) {
      const entryPath = path.join(storageDir, entry);
      if (!fs.statSync(entryPath).isDirectory()) continue;
      // 版本目录格式: x.x.x
      if (!/^\d+\.\d+\.\d+$/.test(entry)) continue;

      let meta = {};
      const metaPath = path.join(entryPath, 'meta.json');
      try {
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }
      } catch (e) { /* ignore */ }

      versions.push({
        version: entry,
        buildNo: meta.buildNo || null,
        pulledAt: meta.pulledAt || null
      });
    }

    // 按版本号降序排序
    versions.sort((a, b) => {
      const pa = a.version.split('.').map(Number);
      const pb = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });

    return versions;
  }

  // 切换到指定版本
  setVersion(version) {
    this.currentVersion = version;
    this.files = {};
    return this.scanAll();
  }

  // 获取当前版本目录
  _getVersionDir(version) {
    version = version || this.currentVersion;
    if (!version) return null;
    return path.join(this.config.get('storage_dir'), version);
  }

  // 确保版本目录及 slot 子目录存在
  ensureVersionDirs(version) {
    const versionDir = this._getVersionDir(version);
    if (!versionDir) return;
    for (const slot of ALL_SLOTS) {
      fs.mkdirSync(path.join(versionDir, slot), { recursive: true });
    }
  }

  // 导入文件到当前版本
  importFile(srcPath) {
    const parsed = parseFileName(srcPath);
    if (!parsed) {
      return { success: false, error: '文件名格式不正确，应为 DICloak_版本号_平台_架构.exe/zip/dmg' };
    }

    // 如果没有当前版本，使用文件的版本号
    if (!this.currentVersion) {
      this.currentVersion = parsed.version;
    }

    const slot = getSlot(parsed);
    this.ensureVersionDirs(this.currentVersion);
    const destDir = path.join(this._getVersionDir(), slot);
    const destPath = path.join(destDir, parsed.cleanFileName);

    // 清理该槽位旧文件
    this._clearSlot(slot);

    // 复制文件
    fs.copyFileSync(srcPath, destPath);
    const stats = fs.statSync(destPath);

    this.files[slot] = {
      filePath: destPath,
      fileName: parsed.cleanFileName,
      version: parsed.version,
      arch: parsed.arch,
      type: parsed.type,
      platform: parsed.platform,
      size: stats.size,
      buildNo: parsed.buildNo
    };

    return { success: true, slot, file: this.files[slot] };
  }

  // 为 FTP 拉取批量保存文件（文件已下载到临时目录）
  importFTPFiles(version, buildNo, downloadedFiles) {
    this.currentVersion = version;
    this.ensureVersionDirs(version);
    this.files = {};

    for (const { tmpPath, parsed } of downloadedFiles) {
      const slot = getSlot(parsed);
      const destDir = path.join(this._getVersionDir(), slot);
      const destPath = path.join(destDir, parsed.cleanFileName);

      // 清理该槽位旧文件
      this._clearSlot(slot);

      // 移动文件（从临时目录到版本目录）
      fs.copyFileSync(tmpPath, destPath);
      fs.unlinkSync(tmpPath);
      const stats = fs.statSync(destPath);

      this.files[slot] = {
        filePath: destPath,
        fileName: parsed.cleanFileName,
        version: parsed.version,
        arch: parsed.arch,
        type: parsed.type,
        platform: parsed.platform,
        size: stats.size,
        buildNo
      };
    }

    // 保存 meta.json
    const metaPath = path.join(this._getVersionDir(), 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      buildNo,
      pulledAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    return { ...this.files };
  }

  _clearSlot(slot) {
    const dir = path.join(this._getVersionDir(), slot);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  }

  deleteFile(slot) {
    const file = this.files[slot];
    if (file && fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath);
    }
    delete this.files[slot];
    return { success: true };
  }

  getFile(slot) { return this.files[slot] || null; }

  // 扫描当前版本目录，加载已有文件
  scanAll() {
    this.files = {};
    const versionDir = this._getVersionDir();
    if (!versionDir || !fs.existsSync(versionDir)) return {};

    // 读取 meta.json 获取构建号
    let buildNo = null;
    const metaPath = path.join(versionDir, 'meta.json');
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        buildNo = meta.buildNo || null;
      }
    } catch (e) { /* ignore */ }

    for (const slot of ALL_SLOTS) {
      const dir = path.join(versionDir, slot);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.startsWith('DICloak_'));
      if (files.length > 0) {
        const fileName = files[0];
        const filePath = path.join(dir, fileName);
        const parsed = parseFileName(filePath);
        if (parsed) {
          const stats = fs.statSync(filePath);
          this.files[slot] = {
            filePath, fileName, ...parsed, size: stats.size, buildNo
          };
        }
      }
    }
    return { ...this.files };
  }

  // 迁移旧目录结构（无版本子目录）到版本目录
  migrateOldStructure() {
    const storageDir = this.config.get('storage_dir');
    // 检查是否有旧结构（直接在 storage_dir 下有 exe-x64 等目录）
    const oldSlotDir = path.join(storageDir, 'exe-x64');
    if (!fs.existsSync(oldSlotDir)) return;

    // 检查是否有文件
    const oldFiles = fs.readdirSync(oldSlotDir).filter(f => f.startsWith('DICloak_'));
    if (oldFiles.length === 0) {
      // 删除空的旧目录
      for (const slot of ALL_SLOTS.slice(0, 4)) { // 只有 win 的 4 个旧 slot
        const dir = path.join(storageDir, slot);
        if (fs.existsSync(dir)) {
          try { fs.rmSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
        }
      }
      return;
    }

    // 解析版本号
    const parsed = parseFileName(oldFiles[0]);
    const version = parsed ? parsed.version : 'unknown';
    const versionDir = path.join(storageDir, version);

    // 移动文件到版本目录
    for (const slot of ['exe-x64', 'exe-ia32', 'zip-x64', 'zip-ia32']) {
      const oldDir = path.join(storageDir, slot);
      const newDir = path.join(versionDir, slot);
      if (fs.existsSync(oldDir)) {
        fs.mkdirSync(newDir, { recursive: true });
        for (const f of fs.readdirSync(oldDir)) {
          fs.renameSync(path.join(oldDir, f), path.join(newDir, f));
        }
        fs.rmSync(oldDir, { recursive: true });
      }
    }

    // 确保 mac 目录也创建
    for (const slot of ['dmg-arm64', 'dmg-x64']) {
      fs.mkdirSync(path.join(versionDir, slot), { recursive: true });
    }
  }
}

module.exports = FileManager;
