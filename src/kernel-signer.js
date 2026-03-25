const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execSync } = require('child_process');
const { parseKernelFileName } = require('./kernel-parser');

class KernelSigner {
  constructor(config, log, progress) {
    this.config = config;
    this.log = log || console.log;
    this.progress = progress || (() => {});
    this.aborted = false;
  }

  cancel() {
    this.aborted = true;
    this.log('用户取消操作');
  }

  // 列出 FTP /core/ 下的内核文件，按大版本+架构分组
  async listCoreFiles() {
    const ftpConfig = this.config.get('ftp');
    if (!ftpConfig || !ftpConfig.host) {
      return { success: false, error: 'FTP 未配置' };
    }

    const kernelConfig = this.config.get('kernel_signing') || {};
    const corePath = kernelConfig.core_ftp_path || '/core/';
    const majorVersions = kernelConfig.major_versions || [120, 134, 142, 143];

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
      this.log('FTP 连接成功');

      this.log(`正在列出目录：${corePath}`);
      const fileList = await client.list(corePath);

      // 解析所有 .7z 文件
      const parsed = [];
      for (const f of fileList) {
        if (f.type === 2) continue; // 跳过目录
        const info = parseKernelFileName(f.name);
        if (!info) continue;
        // 只保留配置中的大版本
        if (!majorVersions.includes(parseInt(info.majorVersion))) continue;
        parsed.push({ ...info, size: f.size });
      }

      this.log(`找到 ${parsed.length} 个匹配的内核文件`);

      // 按大版本+架构分组，每组取最新（timestamp 最大）
      const grouped = {};
      for (const mv of majorVersions) {
        grouped[mv] = { x86: null, x64: null };
      }

      for (const item of parsed) {
        const mv = parseInt(item.majorVersion);
        const arch = item.arch;
        if (!grouped[mv]) continue;
        if (!grouped[mv][arch] || item.timestamp > grouped[mv][arch].timestamp) {
          grouped[mv][arch] = item;
        }
      }

      return { success: true, data: grouped };
    } catch (err) {
      this.log(`FTP 操作失败：${err.message}`);
      return { success: false, error: err.message };
    } finally {
      client.close();
    }
  }

  // 完整签名流程
  async runPipeline(selections) {
    // selections: { versions: [142, 143] } — 选中的大版本号
    this.aborted = false;

    const ftpConfig = this.config.get('ftp');
    const kernelConfig = this.config.get('kernel_signing') || {};
    const corePath = kernelConfig.core_ftp_path || '/core/';

    // 1. 先列出文件确定要处理哪些
    const listResult = await this.listCoreFiles();
    if (!listResult.success) return listResult;

    const filesToProcess = [];
    for (const mv of selections.versions) {
      const group = listResult.data[mv];
      if (!group) continue;
      for (const arch of ['x86', 'x64']) {
        if (group[arch]) {
          filesToProcess.push({ majorVersion: mv, arch, fileInfo: group[arch] });
        }
      }
    }

    if (filesToProcess.length === 0) {
      return { success: false, error: '没有找到需要处理的文件' };
    }

    this.log(`将处理 ${filesToProcess.length} 个内核文件`);

    // 检查 SimplySign
    this._checkSimplySign();

    // 查找压缩工具
    let compressor;
    try {
      compressor = this._findCompressor(kernelConfig);
      this.log(`使用压缩工具：${compressor.type} (${compressor.path})`);
    } catch (err) {
      return { success: false, error: err.message };
    }

    // 检查 signtool
    const signtoolPath = kernelConfig.signtool_path ||
      'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x86\\signtool.exe';
    if (!fs.existsSync(signtoolPath)) {
      return { success: false, error: `signtool.exe 不存在：${signtoolPath}` };
    }

    const workDir = path.join(os.tmpdir(), `kernel_sign_${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const results = {};
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
      // 连接 FTP（保持整个流程复用）
      await client.access({
        host: ftpConfig.host,
        port: ftpConfig.port || 21,
        user: ftpConfig.user || 'anonymous',
        password: ftpConfig.password || '',
        secure: false
      });

      for (const item of filesToProcess) {
        if (this.aborted) {
          this.log('操作已取消');
          break;
        }

        const { majorVersion, arch, fileInfo } = item;
        const label = `${majorVersion}-${arch}`;
        this.log(`\n===== 处理 ${label}: ${fileInfo.fileName} =====`);

        try {
          // Step 1: 下载
          this.progress({ step: 'pull', version: majorVersion, arch, status: 'start' });
          this.log(`[${label}] 正在下载...`);
          const localArchive = path.join(workDir, fileInfo.fileName);
          await client.downloadTo(localArchive, corePath + fileInfo.fileName);
          this.log(`[${label}] 下载完成`);
          this.progress({ step: 'pull', version: majorVersion, arch, status: 'done' });

          if (this.aborted) break;

          // Step 2: 解压
          this.progress({ step: 'extract', version: majorVersion, arch, status: 'start' });
          this.log(`[${label}] 正在解压...`);
          const extractDir = path.join(workDir, `${label}_extracted`);
          fs.mkdirSync(extractDir, { recursive: true });
          await this._extract(compressor, localArchive, extractDir);
          this.log(`[${label}] 解压完成`);
          this.progress({ step: 'extract', version: majorVersion, arch, status: 'done' });

          if (this.aborted) break;

          // Step 3: 签名
          this.progress({ step: 'sign', version: majorVersion, arch, status: 'start' });
          this.log(`[${label}] 正在签名...`);
          const signResult = await this._signDirectory(extractDir, signtoolPath, kernelConfig);
          this.log(`[${label}] 签名完成: ${signResult.signed} 已签名, ${signResult.skipped} 已跳过, ${signResult.failed} 失败`);
          if (signResult.failed > 0) {
            this.log(`[${label}] 警告：有 ${signResult.failed} 个文件签名失败`);
          }
          this.progress({ step: 'sign', version: majorVersion, arch, status: 'done' });

          if (this.aborted) break;

          // Step 4: 重新打包
          this.progress({ step: 'pack', version: majorVersion, arch, status: 'start' });
          this.log(`[${label}] 正在打包...`);
          const signedArchive = path.join(workDir, `signed_${fileInfo.fileName}`);
          await this._repack(compressor, extractDir, signedArchive);
          this.log(`[${label}] 打包完成`);
          this.progress({ step: 'pack', version: majorVersion, arch, status: 'done' });

          if (this.aborted) break;

          // Step 5: 上传回 FTP
          this.progress({ step: 'upload', version: majorVersion, arch, status: 'start' });
          this.log(`[${label}] 正在上传回 FTP...`);
          const remotePath = corePath + fileInfo.fileName;
          // 先删除旧文件
          try {
            await client.remove(remotePath);
            this.log(`[${label}] 已删除旧文件`);
          } catch (e) {
            // 文件可能不存在，忽略
          }
          await client.uploadFrom(signedArchive, remotePath);
          this.log(`[${label}] 上传完成`);
          this.progress({ step: 'upload', version: majorVersion, arch, status: 'done' });

          results[label] = { success: true, signResult };

        } catch (err) {
          this.log(`[${label}] 失败：${err.message}`);
          results[label] = { success: false, error: err.message };
        }
      }
    } catch (err) {
      this.log(`FTP 连接失败：${err.message}`);
      return { success: false, error: err.message };
    } finally {
      client.close();
      // 清理工作目录
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.log('工作目录已清理');
      } catch (e) {
        this.log(`清理工作目录失败：${e.message}`);
      }
    }

    const allSuccess = Object.values(results).every(r => r.success);
    this.log(allSuccess ? '\n全部处理完成！' : '\n部分文件处理失败，请检查日志');
    return { success: allSuccess, results };
  }

  // 检查 SimplySign Desktop 是否在运行
  _checkSimplySign() {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq SimplySign*" /NH', { encoding: 'utf-8' });
      if (output.includes('SimplySign')) {
        this.log('SimplySign Desktop 已运行');
      } else {
        this.log('警告：未检测到 SimplySign Desktop，请确保已连接并完成 2FA 验证');
      }
    } catch {
      this.log('警告：无法检测 SimplySign Desktop 状态，请确保已连接');
    }
  }

  // 查找可用的压缩工具
  _findCompressor(kernelConfig) {
    // 1. 配置中指定的 Bandizip 路径
    if (kernelConfig.bandizip_path && fs.existsSync(kernelConfig.bandizip_path)) {
      return { type: 'bandizip', path: kernelConfig.bandizip_path };
    }

    // 2. 常见 Bandizip 安装路径
    const bandizipPaths = [
      'C:\\Program Files\\Bandizip\\Bandizip.exe',
      'C:\\Program Files (x86)\\Bandizip\\Bandizip.exe'
    ];
    for (const p of bandizipPaths) {
      if (fs.existsSync(p)) {
        return { type: 'bandizip', path: p };
      }
    }

    // 3. 尝试 bc.exe (Bandizip CLI)
    try {
      execSync('bc.exe', { stdio: 'ignore' });
      return { type: 'bandizip-cli', path: 'bc.exe' };
    } catch {}

    // 4. 常见 7-Zip 安装路径
    const sevenZipPaths = [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe'
    ];
    for (const p of sevenZipPaths) {
      if (fs.existsSync(p)) {
        return { type: '7z', path: p };
      }
    }

    // 5. 尝试 PATH 中的 7z
    try {
      execSync('7z', { stdio: 'ignore' });
      return { type: '7z', path: '7z' };
    } catch {}

    throw new Error('未找到压缩工具，请安装 Bandizip 或 7-Zip，或在设置中配置路径');
  }

  // 解压 .7z 文件
  _extract(compressor, archivePath, outputDir) {
    return new Promise((resolve, reject) => {
      let cmd, args;

      if (compressor.type === 'bandizip') {
        // Bandizip.exe bx -o:outputDir archivePath
        cmd = compressor.path;
        args = ['bx', `-o:${outputDir}`, archivePath];
      } else if (compressor.type === 'bandizip-cli') {
        cmd = compressor.path;
        args = ['x', `-o:${outputDir}`, archivePath];
      } else {
        // 7z x archivePath -oOutputDir -y
        cmd = compressor.path;
        args = ['x', archivePath, `-o${outputDir}`, '-y'];
      }

      execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`解压失败: ${err.message}\n${stderr || ''}`));
        } else {
          resolve();
        }
      });
    });
  }

  // 递归签名目录下所有 .exe 和 .dll
  async _signDirectory(dir, signtoolPath, kernelConfig) {
    const thumbprint = kernelConfig.sign_thumbprint || 'bb285531ddd393ae19ed82ceae6d76e0234e817a';
    const timestampUrls = kernelConfig.timestamp_servers || [
      'http://time.certum.pl',
      'http://timestamp.comodoca.com'
    ];

    // 递归扫描 .exe 和 .dll
    const filesToSign = [];
    const scanDir = (d) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (/\.(exe|dll)$/i.test(entry.name)) {
          filesToSign.push(fullPath);
        }
      }
    };
    scanDir(dir);

    this.log(`  扫描到 ${filesToSign.length} 个 exe/dll 文件`);

    let signed = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < filesToSign.length; i++) {
      if (this.aborted) break;

      const file = filesToSign[i];
      const fileName = path.basename(file);
      this.log(`  [${i + 1}/${filesToSign.length}] ${fileName}`);

      // 检查是否已签名
      if (this._isAlreadySigned(signtoolPath, file)) {
        this.log(`    已签名，跳过`);
        skipped++;
        continue;
      }

      // 尝试签名（3轮，每轮尝试所有时间戳服务器）
      let success = false;
      for (let retry = 0; retry < 3 && !success; retry++) {
        for (const url of timestampUrls) {
          try {
            this.log(`    签名中 (尝试 ${retry + 1}/3, ${url})...`);
            execSync(
              `"${signtoolPath}" sign /sha1 "${thumbprint}" /tr "${url}" /td sha256 /fd sha256 /v "${file}"`,
              { stdio: 'pipe', timeout: 60000 }
            );
            // 验证签名
            if (this._isAlreadySigned(signtoolPath, file)) {
              this.log(`    签名成功`);
              signed++;
              success = true;
              break;
            }
          } catch (err) {
            this.log(`    签名失败: ${err.message.substring(0, 100)}`);
          }
          // 延迟 3 秒后重试
          if (!success) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      if (!success) {
        this.log(`    签名最终失败: ${fileName}`);
        failed++;
      }
    }

    return { signed, skipped, failed, total: filesToSign.length };
  }

  // 检查文件是否已签名
  _isAlreadySigned(signtoolPath, filePath) {
    try {
      execSync(`"${signtoolPath}" verify /pa "${filePath}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  // 重新打包为 .7z
  _repack(compressor, sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      let cmd, args;

      if (compressor.type === 'bandizip') {
        cmd = compressor.path;
        args = ['bc', 'a', '-fmt:7z', outputPath, path.join(sourceDir, '*')];
      } else if (compressor.type === 'bandizip-cli') {
        cmd = compressor.path;
        args = ['a', '-fmt:7z', outputPath, path.join(sourceDir, '*')];
      } else {
        // 7z a outputPath sourceDir\*
        cmd = compressor.path;
        args = ['a', '-t7z', outputPath, path.join(sourceDir, '*')];
      }

      execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`打包失败: ${err.message}\n${stderr || ''}`));
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = KernelSigner;
