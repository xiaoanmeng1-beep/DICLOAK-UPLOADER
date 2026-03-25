const { chromium } = require('playwright');
const path = require('path');

class Uploader360 {
  constructor(config, log) {
    this.config = config;
    this.log = log || console.log;
  }

  async upload(fileInfo, slot) {
    if (!fileInfo) return { success: false, error: '没有文件' };

    let context = null;
    let page = null;

    try {
      // 用 launchPersistentContext 启动独立 Chrome 实例
      // 独立 profile，不影响已有 Chrome；本地启动，无 50MB 文件限制
      this.log('启动 Chrome...');
      const chromePath = path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
      const userDataDir = path.join(this.config.get('storage_dir'), 'chrome-360-profile');

      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: chromePath,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check'
        ],
        timeout: 30000
      });
      this.log('✅ Chrome 已启动');

      page = await context.newPage();

      // 1. 打开360提交页面
      this.log('打开 360 软件提交页面...');
      await page.goto('https://open.soft.360.cn/softsubmit.php', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForTimeout(3000);

      // 2. 检查登录状态
      const isLoggedIn = await page.locator('text=退出').isVisible().catch(() => false);
      if (!isLoggedIn) {
        this.log('未登录，正在登录...');
        await this._login(page);
      } else {
        this.log('已登录');
      }

      // 3. 选择"仅软件检测"
      this.log('选择提交方式：仅软件检测');
      await page.locator('label:has-text("仅软件检测")').click();
      await page.waitForTimeout(1000);

      // 4. 选择软件名称
      this.log('选择软件名称：DICloak指纹浏览器');
      await page.locator('select[name="name"]').selectOption({ label: 'DICloak指纹浏览器' });
      await page.waitForTimeout(500);

      // 5. 填写版本号
      this.log(`填写版本号：${fileInfo.version}`);
      const versionInput = page.locator('input[name="version"]');
      await versionInput.click();
      await versionInput.fill(fileInfo.version);
      this.log('✅ 已填写版本号');

      // 6. 填写备注（字段名是 intro）
      const remark = slot.includes('x64')
        ? '请使用windows 64位系统进行下载试用，谢谢'
        : '请使用windows 32位系统进行下载试用，谢谢';
      this.log(`填写备注：${remark}`);
      const introInput = page.locator('input[name="intro"]');
      await introInput.click();
      await introInput.fill(remark);
      this.log('✅ 已填写备注');

      // 7. 上传文件 — 直接 setInputFiles（本地实例无大小限制）
      this.log(`上传文件：${fileInfo.fileName} (${formatSize(fileInfo.size)})`);
      const fileInput = page.locator('input[type="file"][name="file"]').first();
      await fileInput.setInputFiles(fileInfo.filePath);
      this.log('✅ 已选择文件，等待上传...');

      // 8. 等待上传完成（文件名出现在页面上）
      this.log('等待文件上传完成（最长10分钟）...');
      const fileBaseName = fileInfo.fileName.replace(/\.(exe|zip)$/i, '');
      await page.waitForFunction((name) => {
        return document.body.innerText.includes(name);
      }, fileBaseName, { timeout: 600000, polling: 2000 });
      this.log('✅ 文件上传完成');

      await page.waitForTimeout(2000);

      // 9. 点击"提交软件"按钮
      this.log('点击提交软件...');
      const submitBtn = page.locator('button.btn-success[type="submit"]');
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.click();
      this.log('已点击提交');

      await page.waitForTimeout(3000);
      this.log('✅ 360 平台提交成功！');

      // 关闭 Chrome 实例
      await context.close();
      return { success: true };

    } catch (error) {
      this.log(`❌ 上传失败：${error.message}`);
      try { if (context) await context.close(); } catch (e) { /* ignore */ }
      return { success: false, error: error.message };
    }
  }

  async _login(page) {
    const username = this.config.getUsername();
    const password = this.config.getPassword();
    if (!username || !password) {
      throw new Error('请先在设置中填写 360 账号密码');
    }

    this.log('跳转到登录页面...');
    const loginLink = page.locator('text=登录').first();
    if (await loginLink.isVisible().catch(() => false)) {
      await loginLink.click();
      await page.waitForTimeout(3000);
    }

    let loginFrame = page;
    const frames = page.frames();
    for (const frame of frames) {
      const hasLoginInput = await frame.locator('input[placeholder*="手机号"], input[placeholder*="用户名"], input[placeholder*="邮箱"], input[placeholder*="账号"]').first().isVisible().catch(() => false);
      if (hasLoginInput) {
        loginFrame = frame;
        this.log('在 iframe 中找到登录表单');
        break;
      }
    }

    this.log('填写账号...');
    const usernameSelectors = [
      'input[placeholder*="手机号"]', 'input[placeholder*="用户名"]',
      'input[placeholder*="邮箱"]', 'input[placeholder*="账号"]',
      'input[name="account"]', 'input[name="username"]',
      'input[name="userName"]', 'input[type="text"]'
    ];
    for (const sel of usernameSelectors) {
      const el = loginFrame.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await el.fill('');
        await el.type(username, { delay: 50 });
        this.log(`已填写账号到 ${sel}`);
        break;
      }
    }

    this.log('填写密码...');
    const passwordSelectors = [
      'input[type="password"]', 'input[name="password"]',
      'input[placeholder*="密码"]'
    ];
    for (const sel of passwordSelectors) {
      const el = loginFrame.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await el.fill('');
        await el.type(password, { delay: 50 });
        this.log(`已填写密码到 ${sel}`);
        break;
      }
    }

    await page.waitForTimeout(500);

    const agreeCheckbox = loginFrame.locator('input[type="checkbox"]').first();
    if (await agreeCheckbox.isVisible().catch(() => false)) {
      const checked = await agreeCheckbox.isChecked().catch(() => true);
      if (!checked) {
        await agreeCheckbox.click();
        this.log('已勾选同意协议');
      }
    }

    this.log('点击登录按钮...');
    const loginBtnSelectors = [
      'button.quc-button-submit', 'a.quc-button-submit',
      'input.quc-button-submit', 'button[class*="submit"]',
      'a[class*="submit"]', '.quc-submit button',
      '.quc-submit a', 'button:text-is("登录")',
      'a:text-is("登录")', 'button[type="submit"]',
      'input[type="submit"]', 'input[value="登录"]'
    ];
    for (const sel of loginBtnSelectors) {
      const el = loginFrame.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        this.log(`已点击登录按钮: ${sel}`);
        break;
      }
    }

    this.log('等待登录完成（如有验证码请手动完成）...');
    await page.waitForSelector('text=退出', { timeout: 300000 });
    this.log('登录成功');
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

module.exports = Uploader360;
