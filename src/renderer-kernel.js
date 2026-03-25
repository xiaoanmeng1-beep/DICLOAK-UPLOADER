// 内核签名页面前端逻辑
(function () {
  let coreFilesData = null;
  let isRunning = false;

  function addKernelLog(msg) {
    const logContent = document.getElementById('kernel-log-content');
    if (!logContent) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    if (msg.includes('失败') || msg.includes('错误') || msg.includes('Error')) {
      entry.classList.add('error');
    } else if (msg.includes('完成') || msg.includes('成功')) {
      entry.classList.add('success');
    }
    entry.innerHTML = `<span class="timestamp">${time}</span>${msg}`;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  function renderVersionCards(data) {
    const container = document.getElementById('kernel-cards-container');
    if (!data || Object.keys(data).length === 0) {
      container.innerHTML = '<div class="kernel-empty-state">未找到内核文件</div>';
      return;
    }

    container.innerHTML = '';
    const versions = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));

    for (const mv of versions) {
      const group = data[mv];
      const card = document.createElement('div');
      card.className = 'kernel-version-card';
      card.dataset.version = mv;

      const hasFiles = group.x86 || group.x64;

      card.innerHTML = `
        <div class="kernel-card-header">
          <input type="checkbox" class="kernel-card-checkbox" data-version="${mv}" ${hasFiles ? '' : 'disabled'}>
          <span class="kernel-card-version">${mv}</span>
          <span class="badge-kernel">Chromium</span>
        </div>
        <div class="kernel-arch-row">
          <span class="kernel-arch-label">x64</span>
          ${group.x64
            ? `<span class="kernel-arch-file" title="${group.x64.fileName}">${group.x64.fileName}</span>
               <span class="kernel-arch-size">${formatSize(group.x64.size)}</span>`
            : '<span class="kernel-arch-none">无文件</span>'}
        </div>
        <div class="kernel-arch-row">
          <span class="kernel-arch-label">x86</span>
          ${group.x86
            ? `<span class="kernel-arch-file" title="${group.x86.fileName}">${group.x86.fileName}</span>
               <span class="kernel-arch-size">${formatSize(group.x86.size)}</span>`
            : '<span class="kernel-arch-none">无文件</span>'}
        </div>
      `;

      // 点击卡片切换选中
      card.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox' || isRunning) return;
        const cb = card.querySelector('.kernel-card-checkbox');
        if (cb.disabled) return;
        cb.checked = !cb.checked;
        card.classList.toggle('selected', cb.checked);
        updateStartButton();
      });

      // checkbox 变化
      const cb = card.querySelector('.kernel-card-checkbox');
      cb.addEventListener('change', () => {
        card.classList.toggle('selected', cb.checked);
        updateStartButton();
      });

      container.appendChild(card);
    }

    updatePendingCount();
  }

  function getSelectedVersions() {
    const checkboxes = document.querySelectorAll('.kernel-card-checkbox:checked');
    return Array.from(checkboxes).map(cb => parseInt(cb.dataset.version));
  }

  function updateStartButton() {
    const btn = document.getElementById('btn-start-signing');
    const selected = getSelectedVersions();
    btn.disabled = selected.length === 0 || isRunning;
    updatePendingCount();
  }

  function updatePendingCount() {
    const el = document.getElementById('kernel-pending-count');
    if (el) el.textContent = getSelectedVersions().length;
  }

  function resetSteps() {
    document.querySelectorAll('#step-indicator .step').forEach(s => {
      s.classList.remove('active', 'done', 'error');
    });
  }

  function updateStep(step, status) {
    const el = document.querySelector(`#step-indicator .step[data-step="${step}"]`);
    if (!el) return;
    el.classList.remove('active', 'done', 'error');
    if (status === 'start') el.classList.add('active');
    else if (status === 'done') el.classList.add('done');
    else if (status === 'error') el.classList.add('error');
  }

  async function refreshCoreFiles() {
    addKernelLog('正在刷新文件列表...');
    const result = await window.api.listCoreFiles();
    if (result.success) {
      coreFilesData = result.data;
      renderVersionCards(result.data);
      const count = Object.values(result.data).filter(g => g.x86 || g.x64).length;
      document.getElementById('kernel-versions-count').textContent = count;
      addKernelLog(`刷新完成，找到 ${count} 个版本的内核文件`);
    } else {
      addKernelLog(`刷新失败：${result.error}`);
    }
  }

  async function startSigning() {
    const selected = getSelectedVersions();
    if (selected.length === 0) return;

    isRunning = true;
    resetSteps();
    document.getElementById('btn-start-signing').disabled = true;
    document.getElementById('btn-cancel-signing').style.display = '';
    document.querySelectorAll('.kernel-card-checkbox').forEach(cb => cb.disabled = true);

    addKernelLog(`开始签名流程，选中版本：${selected.join(', ')}`);

    const result = await window.api.startKernelSigning({ versions: selected });

    isRunning = false;
    document.getElementById('btn-cancel-signing').style.display = 'none';
    document.querySelectorAll('.kernel-card-checkbox').forEach(cb => cb.disabled = false);
    updateStartButton();

    if (result.success) {
      addKernelLog('全部签名流程完成！');
    } else {
      addKernelLog(`签名流程结束：${result.error || '部分失败'}`);
    }
  }

  window.initKernelPage = function () {
    // 刷新按钮
    document.getElementById('btn-refresh-core').addEventListener('click', refreshCoreFiles);

    // 开始签名
    document.getElementById('btn-start-signing').addEventListener('click', startSigning);

    // 取消签名
    document.getElementById('btn-cancel-signing').addEventListener('click', () => {
      window.api.cancelKernelSigning();
      addKernelLog('正在取消...');
    });

    // 清除日志
    document.getElementById('btn-clear-kernel-log').addEventListener('click', () => {
      const logContent = document.getElementById('kernel-log-content');
      logContent.innerHTML = '<div class="log-entry">日志已清除</div>';
    });

    // 设置面板切换
    document.getElementById('btn-kernel-settings').addEventListener('click', () => {
      const panel = document.getElementById('kernel-settings-panel');
      if (panel.style.display === 'none') {
        panel.style.display = '';
        loadKernelSettings();
      } else {
        panel.style.display = 'none';
      }
    });

    // 保存设置
    document.getElementById('btn-save-kernel-settings').addEventListener('click', async () => {
      const updates = {
        kernel_signing: {
          sign_thumbprint: document.getElementById('input-sign-thumbprint').value,
          signtool_path: document.getElementById('input-signtool-path').value,
          bandizip_path: document.getElementById('input-bandizip-path').value
        }
      };
      await window.api.saveConfig(updates);
      addKernelLog('设置已保存');
    });

    // 监听日志和进度事件
    window.api.onKernelLog((msg) => addKernelLog(msg));
    window.api.onKernelProgress((data) => updateStep(data.step, data.status));
  };

  async function loadKernelSettings() {
    const config = await window.api.getConfig();
    const ks = config.kernel_signing || {};
    document.getElementById('input-sign-thumbprint').value = ks.sign_thumbprint || '';
    document.getElementById('input-signtool-path').value = ks.signtool_path || '';
    document.getElementById('input-bandizip-path').value = ks.bandizip_path || '';
  }
})();
