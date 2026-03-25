const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_STORAGE_DIR = app && app.isPackaged
  ? path.join(app.getPath('userData'), 'DICloak-uploads')
  : path.join(__dirname, '..', 'DICloak-uploads');

const DEFAULT_CONFIG = {
  '360_account': { username: 'business@dicloak.com', password: 'Tianji888.' },
  ftp: {
    host: '192.168.20.12',
    port: 21,
    user: 'cicd',
    password: 'dic001',
    remote_path: '/cicd/prod/origin-master/'
  },
  winscp: {
    path: 'D:\\工具安装路径\\avast杀毒软件工具\\WinSCP\\WinSCP.com',
    session: 'ftp_dicloakcom@whitelisting.avast.com',
    remote_path: '/data/'
  },
  storage_dir: DEFAULT_STORAGE_DIR,
  last_version: '',
  kernel_signing: {
    core_ftp_path: '/core/',
    major_versions: [120, 134, 142, 143],
    sign_thumbprint: 'bb285531ddd393ae19ed82ceae6d76e0234e817a',
    signtool_path: 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x86\\signtool.exe',
    bandizip_path: '',
    timestamp_servers: ['http://time.certum.pl', 'http://timestamp.comodoca.com']
  }
};

class Config {
  constructor() {
    this.configPath = path.join(DEFAULT_CONFIG.storage_dir, 'config.json');
    // 迁移旧配置：如果旧路径有配置文件，复制到新路径
    const oldConfigPath = path.join('C:\\DICloak-uploads', 'config.json');
    if (!fs.existsSync(this.configPath) && fs.existsSync(oldConfigPath)) {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.copyFileSync(oldConfigPath, this.configPath);
    }
    this.data = this._load();
    this._ensureStorageDir();
  }

  _load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 深合并：对嵌套对象合并子字段，空字符串不覆盖默认值
        const loaded = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        for (const key of Object.keys(parsed)) {
          if (typeof parsed[key] === 'object' && parsed[key] !== null && !Array.isArray(parsed[key])
              && typeof loaded[key] === 'object' && loaded[key] !== null) {
            for (const subKey of Object.keys(parsed[key])) {
              // 只有非空值才覆盖默认值
              if (parsed[key][subKey] !== '' && parsed[key][subKey] != null) {
                loaded[key][subKey] = parsed[key][subKey];
              }
            }
          } else if (parsed[key] !== '' && parsed[key] != null) {
            loaded[key] = parsed[key];
          }
        }
        // 始终使用默认的 storage_dir，防止旧配置覆盖
        loaded.storage_dir = DEFAULT_CONFIG.storage_dir;
        return loaded;
      }
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_CONFIG };
  }

  _ensureStorageDir() {
    const dir = this.data.storage_dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  get(key) { return this.data[key]; }

  getAll() {
    return { ...this.data };
  }

  save(updates) {
    // 深合并嵌套对象，避免覆盖已有子字段
    for (const key of Object.keys(updates)) {
      if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])
          && typeof this.data[key] === 'object' && this.data[key] !== null) {
        Object.assign(this.data[key], updates[key]);
      } else {
        this.data[key] = updates[key];
      }
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getPassword() { return this.data['360_account']?.password || ''; }
  getUsername() { return this.data['360_account']?.username || ''; }
}

module.exports = Config;
