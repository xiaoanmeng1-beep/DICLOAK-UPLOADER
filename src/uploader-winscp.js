const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

class UploaderWinSCP {
  constructor(config, log) {
    this.config = config;
    this.log = log || console.log;
  }

  // 上传单个文件
  upload(fileInfo) {
    return this.uploadMultiple([fileInfo]);
  }

  // 同时上传多个文件（一个 WinSCP session 内完成）
  uploadMultiple(fileInfos) {
    // 过滤掉空的
    const validFiles = fileInfos.filter(f => f);
    if (validFiles.length === 0) {
      return Promise.resolve({ success: false, error: '没有文件' });
    }

    return new Promise((resolve) => {
      const winscpPath = this.config.get('winscp')?.path;
      const session = this.config.get('winscp')?.session;
      const remotePath = this.config.get('winscp')?.remote_path || '/data/';

      if (!winscpPath) {
        resolve({ success: false, error: 'WinSCP 路径未配置' });
        return;
      }

      for (const f of validFiles) {
        this.log(`准备上传：${f.fileName}`);
      }
      this.log(`目标：${session}:${remotePath}`);

      // 写临时脚本文件，一次连接上传所有文件
      const scriptPath = path.join(os.tmpdir(), `winscp_upload_${Date.now()}.txt`);
      const xmlLogPath = path.join(os.tmpdir(), `winscp_log_${Date.now()}.xml`);
      const putCommands = validFiles.map(f => `put "${f.filePath}"`);
      const scriptContent = [
        'option batch abort',
        'option confirm off',
        `open "${session}"`,
        `cd "${remotePath}"`,
        ...putCommands,
        'exit'
      ].join('\n');
      fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

      const args = ['/script=' + scriptPath, '/xmllog=' + xmlLogPath];

      this.log(`执行命令（${validFiles.length} 个文件）...`);

      const proc = spawn(winscpPath, args);

      // 定时检查 XML 日志解析上传进度
      const totalSize = validFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      let lastPercent = -1;
      let lastFileName = '';
      const progressTimer = setInterval(() => {
        try {
          if (!fs.existsSync(xmlLogPath)) return;
          const xml = fs.readFileSync(xmlLogPath, 'utf-8');

          // 检测当前正在传输的文件名
          const fileMatches = [...xml.matchAll(/filename="([^"]+)"/g)];
          if (fileMatches.length > 0) {
            const currentFile = fileMatches[fileMatches.length - 1][1];
            const baseName = path.basename(currentFile);
            if (baseName !== lastFileName && baseName.startsWith('DICloak_')) {
              lastFileName = baseName;
              this.log(`正在上传：${baseName}`);
              lastPercent = -1; // 重置进度
            }
          }

          const percentMatches = [...xml.matchAll(/percent="(\d+)"/g)];
          if (percentMatches.length > 0) {
            const percent = parseInt(percentMatches[percentMatches.length - 1][1]);
            if (percent !== lastPercent && percent > 0) {
              lastPercent = percent;
              this.log(`上传进度：${percent}%${lastFileName ? ' - ' + lastFileName : ''}`);
            }
          }
        } catch (e) { /* ignore read errors during write */ }
      }, 2000);

      proc.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) this.log(line.trim());
        }
      });

      proc.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) this.log(`[错误] ${line.trim()}`);
        }
      });

      proc.on('close', (code) => {
        clearInterval(progressTimer);
        try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
        try { fs.unlinkSync(xmlLogPath); } catch (e) { /* ignore */ }
        if (code === 0) {
          this.log(`✅ WinSCP 上传成功！共 ${validFiles.length} 个文件`);
          resolve({ success: true });
        } else {
          this.log(`❌ WinSCP 上传失败，退出码：${code}`);
          resolve({ success: false, error: `退出码 ${code}` });
        }
      });

      proc.on('error', (err) => {
        this.log(`❌ WinSCP 启动失败：${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  }
}

module.exports = UploaderWinSCP;
