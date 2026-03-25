const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseFileName, getSlot } = require('./file-parser');

class FTPPuller {
  constructor(config, log) {
    this.config = config;
    this.log = log || console.log;
  }

  // existingVersions: 已有版本列表 [{ version, buildNo }]
  async pull(existingVersions) {
    const ftpConfig = this.config.get('ftp');
    if (!ftpConfig || !ftpConfig.host) {
      return { success: false, error: 'FTP 未配置' };
    }

    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
      this.log('正在连接 FTP 服务器...');
      await client.access({
        host: ftpConfig.host,
        port: ftpConfig.port || 21,
        user: ftpConfig.user || 'anonymous',
        password: ftpConfig.password || '',
        secure: false
      });
      this.log('✅ FTP 连接成功');

      // 列出远程目录文件
      const remotePath = ftpConfig.remote_path || '/cicd/prod/origin-master/';
      this.log(`正在列出目录：${remotePath}`);
      const fileList = await client.list(remotePath);

      // 过滤 DICloak 文件
      const dicloakFiles = fileList.filter(f => f.name.startsWith('DICloak_') && f.type !== 2);
      if (dicloakFiles.length === 0) {
        return { success: false, error: '远程目录中没有找到 DICloak 文件' };
      }

      this.log(`找到 ${dicloakFiles.length} 个 DICloak 文件`);

      // 解析所有文件
      let version = null;
      const allParsed = []; // { remoteFile, parsed, slot }

      for (const f of dicloakFiles) {
        const parsed = parseFileName(f.name);
        if (!parsed) {
          this.log(`跳过无法识别的文件：${f.name}`);
          continue;
        }
        if (!version) version = parsed.version;
        const slot = getSlot(parsed);
        allParsed.push({ remoteFile: f, parsed, slot });
      }

      if (!version) {
        return { success: false, error: '无法从文件名解析版本号' };
      }

      // 每个 slot 各自取构建号最大的文件
      // 例如 x64 的最大构建号是 2379，ia32 的是 292，mac arm64 的是 785
      const bestPerSlot = {};
      for (const item of allParsed) {
        const { slot, parsed } = item;
        const num = parsed.buildNo ? parseInt(parsed.buildNo) : 0;
        if (!bestPerSlot[slot] || num > (bestPerSlot[slot].num || 0)) {
          bestPerSlot[slot] = { ...item, num };
        }
      }

      const filesToDownload = Object.values(bestPerSlot);
      // 用各 slot 最大构建号中的全局最大值作为版本标识
      const maxBuildNo = filesToDownload.reduce((max, item) => {
        return item.num > max ? item.num : max;
      }, 0);
      const buildNo = maxBuildNo > 0 ? String(maxBuildNo) : null;

      this.log(`远程版本：${version}`);
      for (const item of filesToDownload) {
        this.log(`  ${item.slot}: #${item.parsed.buildNo || '?'} - ${item.remoteFile.name}`);
      }

      // 检查是否已有相同版本且构建号不比远程小
      if (existingVersions && existingVersions.length > 0) {
        const existing = existingVersions.find(v => v.version === version);
        if (existing && existing.buildNo && buildNo) {
          const existingNum = parseInt(existing.buildNo);
          const remoteNum = parseInt(buildNo);
          if (remoteNum <= existingNum) {
            this.log(`⚠️ 本地已有 v${version} 构建 #${existing.buildNo}，远程最大构建 #${buildNo} 不比本地新，跳过拉取`);
            return { success: false, error: `本地已有相同或更新的构建 (#${existing.buildNo})，无需拉取` };
          }
          this.log(`本地有 v${version} 构建 #${existing.buildNo}，远程有更新构建，开始下载`);
        }
      }

      this.log(`将下载 ${filesToDownload.length} 个文件`);

      // 下载文件到临时目录
      const tmpDir = path.join(os.tmpdir(), `dicloak_ftp_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const downloadedFiles = [];

      for (let i = 0; i < filesToDownload.length; i++) {
        const { remoteFile, parsed } = filesToDownload[i];
        const tmpPath = path.join(tmpDir, parsed.cleanFileName);
        const remoteFilePath = remotePath + remoteFile.name;

        this.log(`[${i + 1}/${filesToDownload.length}] 下载：${remoteFile.name} (${formatSize(remoteFile.size)})`);

        await client.downloadTo(tmpPath, remoteFilePath);
        this.log(`[${i + 1}/${filesToDownload.length}] ✅ ${parsed.cleanFileName} 下载完成`);

        downloadedFiles.push({ tmpPath, parsed });
      }

      this.log(`全部 ${downloadedFiles.length} 个文件下载完成`);

      return {
        success: true,
        version,
        buildNo,
        downloadedFiles
      };

    } catch (err) {
      this.log(`❌ FTP 操作失败：${err.message}`);
      return { success: false, error: err.message };
    } finally {
      client.close();
    }
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

module.exports = FTPPuller;
