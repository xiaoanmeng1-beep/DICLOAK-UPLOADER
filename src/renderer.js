// ── 工具函数 ──
function formatSize(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function timestamp() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

function addLog(msg) {
  const el = document.getElementById('log-content');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  if (msg.includes('✅')) entry.classList.add('success');
  if (msg.includes('❌')) entry.classList.add('error');
  entry.innerHTML = `<span class="timestamp">[${timestamp()}]</span>${msg}`;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
}

let currentVersion = null;

// ── 卡片状态更新 ──
function updateCard(slot, fileInfo) {
  const card = document.querySelector(`.file-card[data-slot="${slot}"]`);
  if (!card) return;

  const dropZone = card.querySelector('.drop-zone');
  const fileInfoEl = card.querySelector('.file-info');
  const statusDot = card.querySelector('.status-dot');

  if (fileInfo) {
    dropZone.style.display = 'none';
    fileInfoEl.style.display = 'flex';
    card.querySelector('.file-name').textContent = fileInfo.fileName;
    card.querySelector('.version-input').value = fileInfo.version;
    card.querySelector('.file-size').textContent = formatSize(fileInfo.size);
    statusDot.dataset.status = 'ready';
  } else {
    dropZone.style.display = 'flex';
    fileInfoEl.style.display = 'none';
    statusDot.dataset.status = 'empty';
  }
}

function updateAllCards(files) {
  // 先重置所有卡片
  const allSlots = ['exe-x64', 'exe-ia32', 'zip-x64', 'zip-ia32', 'dmg-arm64', 'dmg-x64'];
  for (const slot of allSlots) {
    updateCard(slot, files[slot] || null);
  }
}

function setCardStatus(slot, status) {
  const card = document.querySelector(`.file-card[data-slot="${slot}"]`);
  if (!card) return;
  const statusDot = card.querySelector('.status-dot');
  statusDot.dataset.status = status;
  card.dataset.uploading = status === 'uploading' ? 'true' : 'false';
}

// ── 版本侧边栏 ──
async function loadVersionList() {
  const versions = await window.api.getVersions();
  const list = document.getElementById('version-list');
  list.innerHTML = '';

  if (versions.length === 0) {
    list.innerHTML = '<div class="version-empty">暂无版本<br>点击上方按钮拉取</div>';
    return;
  }

  for (const v of versions) {
    const item = document.createElement('div');
    item.className = 'version-item';
    if (v.version === currentVersion) {
      item.classList.add('active');
    }

    const buildLabel = v.buildNo ? `#${v.buildNo}` : '';
    const timeLabel = v.pulledAt ? new Date(v.pulledAt).toLocaleDateString('zh-CN') : '';

    item.innerHTML = `
      <div class="version-main">
        <span class="version-number">v${v.version}</span>
        ${buildLabel ? `<span class="version-build">${buildLabel}</span>` : ''}
      </div>
      ${timeLabel ? `<div class="version-time">${timeLabel}</div>` : ''}
    `;

    item.addEventListener('click', () => switchVersion(v.version));
    list.appendChild(item);
  }
}

async function switchVersion(version) {
  currentVersion = version;
  const files = await window.api.switchVersion(version);
  updateAllCards(files);
  updateVersionBadge(version);
  loadVersionList();
  addLog(`切换到版本 ${version}`);
}

function updateVersionBadge(version) {
  const badge = document.getElementById('current-version-badge');
  if (version) {
    badge.textContent = `v${version}`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── FTP 拉取 ──
async function pullFromFTP() {
  const btn = document.getElementById('btn-pull-ftp');
  btn.disabled = true;
  btn.textContent = '拉取中...';
  addLog('开始从 FTP 拉取文件...');

  try {
    const result = await window.api.pullFromFTP();
    if (result.success) {
      currentVersion = result.version;
      updateAllCards(result.files);
      updateVersionBadge(result.version);
      await loadVersionList();
      addLog(`✅ 拉取完成：v${result.version} (构建 #${result.buildNo})`);
    } else {
      addLog(`❌ 拉取失败：${result.error}`);
    }
  } catch (err) {
    addLog(`❌ 拉取异常：${err.message || err}`);
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 拉取新版本`;
}

// ── 拖拽处理 ──
function setupDragDrop() {
  const dropZones = document.querySelectorAll('.drop-zone');

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');

      const files = e.dataTransfer.files;
      if (files.length === 0) return;

      for (const file of files) {
        addLog(`导入文件：${file.name}`);
        const filePath = window.api.getPathForFile(file);
        const result = await window.api.importFile(filePath);
        if (result.success) {
          updateCard(result.slot, result.file);
          addLog(`✅ 已导入到 ${result.slot}：${result.file.fileName}`);
        } else {
          addLog(`❌ 导入失败：${result.error}`);
        }
      }
    });

    // 点击选择文件
    zone.addEventListener('click', async (e) => {
      if (e.target.classList.contains('select-link')) e.preventDefault();
      const result = await window.api.selectFile();
      if (result && result.success) {
        updateCard(result.slot, result.file);
        addLog(`✅ 已导入到 ${result.slot}：${result.file.fileName}`);
      } else if (result && !result.success) {
        addLog(`❌ 导入失败：${result.error}`);
      }
    });
  });

  // 全局拖拽 - 支持拖拽到整个窗口
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (const file of files) {
      addLog(`导入文件：${file.name}`);
      const filePath = window.api.getPathForFile(file);
      const result = await window.api.importFile(filePath);
      if (result.success) {
        updateCard(result.slot, result.file);
        addLog(`✅ 已导入到 ${result.slot}：${result.file.fileName}`);
      } else {
        addLog(`❌ 导入失败：${result.error}`);
      }
    }
  });
}

// ── 按钮事件 ──
function setupButtons() {
  // FTP 拉取
  document.getElementById('btn-pull-ftp').addEventListener('click', pullFromFTP);

  // 删除按钮
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.file-card');
      const slot = card.dataset.slot;
      await window.api.deleteFile(slot);
      updateCard(slot, null);
      addLog(`已删除 ${slot} 文件`);
    });
  });

  // 替换按钮
  document.querySelectorAll('.btn-replace').forEach(btn => {
    btn.addEventListener('click', async () => {
      const result = await window.api.selectFile();
      if (result && result.success) {
        updateCard(result.slot, result.file);
        addLog(`✅ 已替换：${result.file.fileName}`);
      }
    });
  });

  // 上传按钮
  document.querySelectorAll('.btn-upload').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.file-card');
      const slot = card.dataset.slot;
      btn.disabled = true;
      setCardStatus(slot, 'uploading');

      let result;
      if (slot.startsWith('exe-')) {
        addLog(`开始上传 ${slot} 到 360 平台...`);
        result = await window.api.upload360(slot);
      } else {
        addLog(`开始上传 ${slot} 到 WinSCP 服务器...`);
        result = await window.api.uploadWinSCP(slot);
      }

      setCardStatus(slot, result.success ? 'success' : 'failed');
      btn.disabled = false;
    });
  });

  // 全部上传
  document.getElementById('btn-upload-all').addEventListener('click', async () => {
    const btn = document.getElementById('btn-upload-all');
    btn.disabled = true;
    addLog('开始全部上传...');
    await window.api.uploadAll();
    addLog('全部上传任务完成');
    btn.disabled = false;
  });

  // 打开存放目录
  document.getElementById('btn-open-dir').addEventListener('click', () => {
    window.api.openStorageDir();
  });

  // 清除日志
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('log-content').innerHTML = '';
  });

  // 设置面板切换
  document.getElementById('btn-settings').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // WinSCP 配置文档
  document.getElementById('btn-winscp-doc').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openWinSCPDoc();
  });

  // 保存设置
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const username = document.getElementById('input-username').value;
    const password = document.getElementById('input-password').value;
    const ftpUser = document.getElementById('input-ftp-user').value;
    const ftpPassword = document.getElementById('input-ftp-password').value;
    const winscpPath = document.getElementById('input-winscp-path').value;

    const updates = {};
    if (username || password) {
      updates['360_account'] = { username, password };
    }
    if (ftpUser || ftpPassword) {
      updates.ftp = { user: ftpUser, password: ftpPassword };
    }
    if (winscpPath) {
      updates.winscp = { path: winscpPath };
    }

    await window.api.saveConfig(updates);
    addLog('✅ 设置已保存');
  });
}

// ── 初始化 ──
async function init() {
  // 页面切换逻辑
  document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
      document.querySelectorAll('.sidebar-page').forEach(p => p.style.display = 'none');
      const pageContent = document.querySelector(`.page-content[data-page="${page}"]`);
      const sidebarPage = document.querySelector(`.sidebar-page[data-for="${page}"]`);
      if (pageContent) pageContent.style.display = 'flex';
      if (sidebarPage) sidebarPage.style.display = 'flex';
    });
  });

  // 初始化内核签名页面
  if (window.initKernelPage) window.initKernelPage();

  setupDragDrop();
  setupButtons();

  // 加载配置（包含默认账号密码）
  const config = await window.api.getConfig();
  if (config['360_account']) {
    document.getElementById('input-username').value = config['360_account'].username || '';
    document.getElementById('input-password').value = config['360_account'].password || '';
  }
  if (config.ftp) {
    document.getElementById('input-ftp-user').value = config.ftp.user || '';
    document.getElementById('input-ftp-password').value = config.ftp.password || '';
  }
  if (config.winscp) {
    document.getElementById('input-winscp-path').value = config.winscp.path || '';
  }

  // 加载版本列表
  await loadVersionList();

  // 自动选择最新版本
  const versions = await window.api.getVersions();
  if (versions.length > 0) {
    await switchVersion(versions[0].version);
  }

  // 监听日志
  window.api.onLog((msg) => addLog(msg));

  // 监听上传状态
  window.api.onUploadStatus(({ slot, status }) => {
    setCardStatus(slot, status);
  });
}

document.addEventListener('DOMContentLoaded', init);
