// 从文件名解析版本号、架构、类型
// 示例: DICloak_2.8.12_win_x64.exe → { version: '2.8.12', arch: 'x64', type: 'exe', platform: 'win' }
// 示例: DICloak_2.8.12_mac_arm64.dmg → { version: '2.8.12', arch: 'arm64', type: 'dmg', platform: 'mac' }
// 示例: DICloak_2.8.12_win_x64_2356.zip → { version: '2.8.12', arch: 'x64', type: 'zip', platform: 'win', buildNo: '2356' }
const path = require('path');

function parseFileName(filePath) {
  const fileName = path.basename(filePath);

  // 匹配带或不带构建号的文件名
  // Win: DICloak_2.8.12_win_x64.exe 或 DICloak_2.8.12_win_x64_2356.exe
  // Mac: DICloak_2.8.12_mac_arm64.dmg 或 DICloak_2.8.12_mac_arm64_2356.dmg
  const match = fileName.match(/DICloak_(\d+\.\d+\.\d+)_(win|mac)_(x64|ia32|arm64)(?:_(\d+))?\.(exe|zip|dmg)/i);
  if (!match) return null;

  const result = {
    fileName,
    version: match[1],
    platform: match[2].toLowerCase(),
    arch: match[3].toLowerCase(),
    type: match[4] ? match[5].toLowerCase() : match[5].toLowerCase(), // type is always match[5]
    buildNo: match[4] || null
  };

  // 去掉构建号后的干净文件名
  result.cleanFileName = `DICloak_${result.version}_${result.platform}_${result.arch}.${result.type}`;

  return result;
}

// 根据解析结果确定文件槽位
function getSlot(parsed) {
  if (!parsed) return null;
  return `${parsed.type}-${parsed.arch}`;
}

// 根据槽位返回备注说明
function getRemark(slot) {
  const remarks = {
    'exe-x64': '请使用windows 64位系统进行下载试用，谢谢',
    'exe-ia32': '请使用windows 32位系统进行下载试用，谢谢',
    'zip-x64': '',
    'zip-ia32': '',
    'dmg-arm64': 'Mac ARM64 (Apple Silicon)',
    'dmg-x64': 'Mac Intel x64'
  };
  return remarks[slot] || '';
}

// 所有槽位
const ALL_SLOTS = ['exe-x64', 'exe-ia32', 'zip-x64', 'zip-ia32', 'dmg-arm64', 'dmg-x64'];
const WIN_SLOTS = ['exe-x64', 'exe-ia32', 'zip-x64', 'zip-ia32'];
const MAC_SLOTS = ['dmg-arm64', 'dmg-x64'];

module.exports = { parseFileName, getSlot, getRemark, ALL_SLOTS, WIN_SLOTS, MAC_SLOTS };
