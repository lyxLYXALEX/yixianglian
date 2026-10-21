#!/usr/bin/env node
/* ==================================================================
   照片压缩：把原图变成网站能用的 WebP
   ------------------------------------------------------------------
   为什么需要它：
     相机/手机原图一张 3–8MB，直接放进网站，一个近况页就能让朋友
     在手机上等半分钟，而且几百张就撑爆 GitHub Pages 的 1GB。

   它做什么（每张图输出两个尺寸）：
     xxx-thumb.webp   缩略图，网格里显示的那张，几十 KB
     xxx-view.webp    点开看的那张，一两百 KB 起步

   怎么用：
     1. 把原图丢进项目根目录的 raw/（可以带子文件夹）
     2. 在 tools 目录里第一次使用时先跑一次：npm install
     3. 回到项目根目录：
          node tools/compress-photos.js          以「近况」档压缩（手机照片）
          node tools/compress-photos.js --work   以「作品」档压缩（相机照片）
          node tools/compress-photos.js --check  只统计现有体积，不动文件
     4. 输出的 webp 在 photos/ 里，原图会被移到 archive/ 保留备份

   两档参数的区别：
     近况档 view 长边 1600px —— 手机屏和普通笔记本完全够看
     作品档 view 长边 2400px —— 相机照片，放大看细节也不糊
     （体积差约一倍，所以别拿作品档去压近况，纯属浪费）

   注意：HEIC 格式（iPhone 默认）sharp 解不了。拍之前在手机设置里
   改成「兼容性最佳」，或者用相册导出成 JPG 再放进来。
   ================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- 依赖检查：缺了就给人话，不要甩一堆报错 ---------- */
let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('\n缺少图片处理库 sharp。\n');
  console.error('第一次使用，先在 tools 目录里装一次依赖：\n');
  console.error('    cd tools');
  console.error('    npm install\n');
  process.exit(1);
}

/* ---------- 路径 ---------- */
const ROOT = path.join(__dirname, '..');
const DEFAULT_IN = path.join(ROOT, 'raw');
const DEFAULT_OUT = path.join(ROOT, 'photos');
const ARCHIVE = path.join(ROOT, 'archive');

/* ---------- 两档压缩方案 ---------- */
const PROFILES = {
  album: {
    label: '近况档（手机照片）',
    thumb: { edge: 800, quality: 78 },
    view: { edge: 1600, quality: 84 }
  },
  work: {
    label: '作品档（相机照片）',
    thumb: { edge: 800, quality: 80 },
    view: { edge: 2400, quality: 86 }
  }
};

const SUPPORTED = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'];

/* 统计时还要算上这些（压缩时不碰它们） */
const CHECK_EXT = SUPPORTED.concat(['.svg', '.gif', '.ico']);

/* ---------- 小工具 ---------- */
function kb(bytes) {
  return Math.round(bytes / 1024);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 小于 1MB 时用 KB 表示，免得出现「0.0 MB」这种没信息的数字 */
function size(bytes) {
  return bytes < 1024 * 1024 ? kb(bytes) + ' KB' : mb(bytes) + ' MB';
}

function pad(str, len) {
  const s = String(str);
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

/** 递归收集目录下的图片；exts 不传就只收可压缩的格式 */
function collect(dir, exts, list) {
  list = list || [];
  const wanted = exts || SUPPORTED;
  if (!fs.existsSync(dir)) return list;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === 'archive' || name.startsWith('.')) continue;
      collect(full, wanted, list);
    } else if (wanted.includes(path.extname(name).toLowerCase())) {
      list.push(full);
    }
  }
  return list;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ---------- 生成一张尺寸 ---------- */
async function renderOne(input, output, edge, quality) {
  await sharp(input)
    /* rotate() 不带参数 = 按 EXIF 摆正方向，否则竖拍的照片会躺倒 */
    .rotate()
    /* inside：把图塞进 edge×edge 的框里，长边刚好等于 edge，不放大 */
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: quality, effort: 5 })
    .toFile(output);
}

/* ---------- 主流程：压缩 ---------- */
async function compress(inDir, outDir, profileKey) {
  const profile = PROFILES[profileKey];

  /* 第一次用的时候 raw/ 还不存在，先建好，省得你手动新建 */
  if (!fs.existsSync(inDir)) {
    fs.mkdirSync(inDir, { recursive: true });
  }

  const files = collect(inDir);

  if (!files.length) {
    console.log(`\n${inDir} 里没有找到图片。`);
    console.log('把原图放进 raw/ 再跑这个命令，或者用 --in 指定别的文件夹。\n');
    return;
  }

  ensureDir(outDir);
  ensureDir(ARCHIVE);

  console.log(`\n方案：${profile.label}`);
  console.log(
    `  缩略图 长边 ${profile.thumb.edge}px / 质量 ${profile.thumb.quality}` +
      `   展示图 长边 ${profile.view.edge}px / 质量 ${profile.view.quality}`
  );
  console.log(`  共 ${files.length} 张，原图在 ${path.relative(ROOT, inDir)}\n`);
  console.log(
    '  ' + pad('文件', 26) + pad('原图', 9) + pad('缩略', 8) + pad('展示', 9) + '压缩到'
  );
  console.log('  ' + '-'.repeat(62));

  let beforeTotal = 0;
  let afterTotal = 0;
  let done = 0;
  const usedNames = new Map();

  for (const file of files) {
    const base = path.basename(file, path.extname(file));
    const rel = path.relative(ROOT, file);

    /* 同名保护：两张不同的原图撞名会把对方覆盖掉 */
    if (usedNames.has(base)) {
      console.log(`  跳过 ${rel}：和 ${usedNames.get(base)} 同名，请先改名`);
      continue;
    }
    usedNames.set(base, rel);

    const thumbPath = path.join(outDir, base + '-thumb.webp');
    const viewPath = path.join(outDir, base + '-view.webp');

    try {
      const before = fs.statSync(file).size;
      await renderOne(file, thumbPath, profile.thumb.edge, profile.thumb.quality);
      await renderOne(file, viewPath, profile.view.edge, profile.view.quality);

      const after =
        fs.statSync(thumbPath).size + fs.statSync(viewPath).size;

      beforeTotal += before;
      afterTotal += after;
      done++;

      const ratio = before ? Math.round((after / before) * 100) : 0;
      console.log(
        '  ' +
          pad(base.length > 24 ? base.slice(0, 23) + '…' : base, 26) +
          pad(mb(before) + 'MB', 9) +
          pad(kb(fs.statSync(thumbPath).size) + 'KB', 8) +
          pad(kb(fs.statSync(viewPath).size) + 'KB', 9) +
          ratio + '%'
      );

      /* 原图挪去归档，不重复占地方，也不进仓库 */
      const archivePath = path.join(ARCHIVE, path.basename(file));
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
      fs.renameSync(file, archivePath);
    } catch (err) {
      console.log(`  失败 ${rel}：${err.message}`);
    }
  }

  console.log('  ' + '-'.repeat(62));
  console.log(
    `  完成 ${done} 张：${mb(beforeTotal)}MB → ${mb(afterTotal)}MB` +
      `（约 ${beforeTotal ? Math.round((afterTotal / beforeTotal) * 100) : 0}%）`
  );
  console.log(`  原图已移到 archive/，随时可以取回\n`);
  console.log('下一步：把 photos/ 里新生成的 -view.webp 写进 content/updates/*.md 的 photos 行，');
  console.log('（或者作品条目的 photo 字段），缩略图会自动被引用。\n');
}

/* ---------- 统计：看看现在占了多少 ---------- */
function check(outDir) {
  if (!fs.existsSync(outDir)) {
    console.log('\nphotos/ 还不存在。\n');
    return;
  }

  const files = collect(outDir, CHECK_EXT);
  if (!files.length) {
    console.log('\nphotos/ 里还没有东西。\n');
    return;
  }

  const rows = files
    .map((f) => ({ name: path.basename(f), size: fs.statSync(f).size }))
    .sort((a, b) => b.size - a.size);

  const total = rows.reduce((sum, r) => sum + r.size, 0);
  const views = rows.filter((r) => r.name.endsWith('-view.webp'));
  const thumbs = rows.filter((r) => r.name.endsWith('-thumb.webp'));
  const others = rows.length - views.length - thumbs.length;

  /* 一张照片的实际占用 = 展示图 + 缩略图 */
  const photoBytes = rows
    .filter((r) => /-(view|thumb)\.webp$/.test(r.name))
    .reduce((sum, r) => sum + r.size, 0);

  console.log('\n当前 photos/ 占用\n');
  console.log(`  文件数  ${rows.length}`);
  console.log(`  总大小  ${size(total)}`);
  if (views.length) {
    console.log(
      `  照片组  ${views.length} 张（含缩略图，平均每张 ${kb(photoBytes / views.length)}KB）`
    );
  }
  if (others) {
    console.log(`  其它    ${others} 个（占位图、图标等）`);
  }

  console.log('\n  体积最大的 5 个：');
  rows.slice(0, 5).forEach((r) => {
    console.log('    ' + pad(r.name, 34) + kb(r.size) + 'KB');
  });

  /* 容量换算：GitHub Pages 站点上限 1GB（官方文档口径，2026-10 核对） */
  const LIMIT = 1024 * 1024 * 1024;
  const avgPerPhoto = views.length ? photoBytes / views.length : 0.42 * 1024 * 1024;
  const left = Math.max(LIMIT - total, 0);

  console.log('\n容量预估（按 GitHub Pages 1GB 上限）\n');
  console.log(`  已用      ${size(total)}（${Math.round((total / LIMIT) * 100)}%）`);
  console.log(`  还可用    ${size(left)}`);
  if (views.length) {
    console.log(`  每张均值  ${size(avgPerPhoto)}（实测，含缩略图）`);
    console.log(`  还能放约  ${Math.floor(left / avgPerPhoto)} 张\n`);
  } else {
    console.log(`  每张按 0.4MB 估，还能放约 ${Math.floor(left / (0.4 * 1024 * 1024))} 张\n`);
  }
  console.log('  注：这是站点总容量。真到 80% 就该考虑把老照片挪去 R2 了。\n');
}

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const opts = {
    mode: 'compress',
    profile: 'album',
    inDir: DEFAULT_IN,
    outDir: DEFAULT_OUT
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.mode = 'check';
    else if (a === '--work') opts.profile = 'work';
    else if (a === '--album') opts.profile = 'album';
    else if (a === '--in') opts.inDir = path.resolve(argv[++i]);
    else if (a === '--out') opts.outDir = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') opts.mode = 'help';
  }
  return opts;
}

function help() {
  console.log(`
照片压缩脚本

  node tools/compress-photos.js           压缩 raw/ 里的图（近况档）
  node tools/compress-photos.js --work    压缩 raw/ 里的图（作品档，更大更清晰）
  node tools/compress-photos.js --check   统计 photos/ 现在占了多少、还能放多少张

可选参数
  --in  <文件夹>   原图来源，默认 raw/
  --out <文件夹>   输出位置，默认 photos/
`);
}

/* ---------- 入口 ---------- */
(async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === 'help') return help();
  if (opts.mode === 'check') return check(opts.outDir);

  await compress(opts.inDir, opts.outDir, opts.profile);
})().catch((err) => {
  console.error('\n出错了：' + err.message + '\n');
  process.exit(1);
});
