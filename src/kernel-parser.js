// 内核文件名解析器
// 示例: GinsBrowser_202603121726_x64_1431c4e412096c9a.7z
// → { filename, timestamp: '202603121726', arch: 'x64', hash: '1431c4e412096c9a', majorVersion: '143' }
const path = require('path');

const KERNEL_REGEX = /^GinsBrowser_(\d{12})_(x86|x64)_([a-f0-9]+)\.7z$/i;

function parseKernelFileName(filePath) {
  const fileName = path.basename(filePath);
  const match = fileName.match(KERNEL_REGEX);
  if (!match) return null;

  return {
    fileName,
    timestamp: match[1],
    arch: match[2].toLowerCase(),
    hash: match[3].toLowerCase(),
    majorVersion: match[3].substring(0, 3)
  };
}

module.exports = { parseKernelFileName };
