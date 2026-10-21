#!/usr/bin/env node
/**
 * 占位图生成脚本
 * ------------------------------------------------------------------
 * 作用：生成 photos/ 里的示例图片（SVG 格式）和站点的 favicon。
 * 这些图片只是为了把版式撑起来，真实使用前请替换成自己的照片。
 *
 * 用法：node tools/make-placeholder-photos.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'photos');
const ASSETS_DIR = path.join(ROOT, 'assets');

/* 全部选亮度较高的颜色，保证上面的黑色文字看得清 */
const COLORS = ['#FF3B00', '#D6FF00', '#00C2B2', '#FF2E93', '#C8B6FF', '#FFB000', '#7BE0FF'];

/** 生成一张 4:3 的占位图 */
function makePhoto(index) {
  const bg = COLORS[(index - 1) % COLORS.length];
  const num = String(index).padStart(2, '0');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img" aria-label="示例图片 ${num}">
  <rect width="800" height="600" fill="${bg}"/>
  <g stroke="#111111" stroke-width="5" fill="none" opacity="0.55">
    <path d="M0 200H800M0 400H800M200 0V600M400 0V600M600 0V600"/>
  </g>
  <circle cx="612" cy="150" r="86" fill="none" stroke="#111111" stroke-width="12"/>
  <rect x="332" y="316" width="136" height="136" fill="none" stroke="#111111" stroke-width="12"/>
  <text x="44" y="64" font-family="monospace" font-size="26" letter-spacing="4" fill="#111111">示例图片 / 可替换</text>
  <text x="44" y="540" font-family="monospace" font-size="128" font-weight="700" fill="#111111">${num}</text>
</svg>
`;
}

/** 关于页用的正方形占位人像 */
function makeAboutPhoto() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="示例人像，可替换">
  <rect width="600" height="600" fill="#1B1BE0"/>
  <g stroke="#D6FF00" stroke-width="4" fill="none" opacity="0.8">
    <path d="M0 150H600M0 300H600M0 450H600M150 0V600M300 0V600M450 0V600"/>
  </g>
  <circle cx="300" cy="248" r="92" fill="none" stroke="#D6FF00" stroke-width="10"/>
  <path d="M132 528c0-96 74-156 168-156s168 60 168 156" fill="none" stroke="#D6FF00" stroke-width="10"/>
  <text x="40" y="72" font-family="monospace" font-size="24" letter-spacing="4" fill="#D6FF00">示例人像 / 可替换</text>
</svg>
`;
}

function makeFavicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" fill="#111111"/>
  <rect x="7" y="7" width="18" height="18" fill="#FF3B00"/>
  <rect x="13" y="13" width="6" height="6" fill="#D6FF00"/>
</svg>
`;
}

function main() {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  for (let i = 1; i <= 7; i++) {
    const name = `photo-${String(i).padStart(2, '0')}.svg`;
    fs.writeFileSync(path.join(PHOTO_DIR, name), makePhoto(i), 'utf8');
  }
  fs.writeFileSync(path.join(PHOTO_DIR, 'about.svg'), makeAboutPhoto(), 'utf8');
  fs.writeFileSync(path.join(ASSETS_DIR, 'favicon.svg'), makeFavicon(), 'utf8');

  console.log('占位图生成完成：photos/photo-01 ~ 07.svg、photos/about.svg、assets/favicon.svg');
}

main();
