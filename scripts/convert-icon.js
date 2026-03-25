const sharp = require('sharp');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

async function convert() {
  const svgPath = path.join(__dirname, '..', 'assets', 'icon3-cube.svg');
  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');

  // SVG -> PNG 256x256
  await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(pngPath);

  // PNG -> ICO
  const buf = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, buf);

  console.log('Done! icon.ico and icon.png created in assets/');
}

convert().catch(console.error);
