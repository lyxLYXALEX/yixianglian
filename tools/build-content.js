#!/usr/bin/env node
/**
 * 内容构建脚本
 * ------------------------------------------------------------------
 * 作用：读取 content/ 下的 Markdown 文件，生成浏览器能直接读取的 content/data.js
 *
 * 为什么要这一步：
 *   直接双击打开 HTML 时，浏览器出于安全限制不允许用 fetch 读本地文件，
 *   而 <script src="..."> 是允许的。所以把 Markdown 预编译成一个 JS 数据文件，
 *   页面就能在「双击打开」和「静态服务器」两种方式下都正常显示内容。
 *
 * 用法：node tools/build-content.js
 * 依赖：只用 Node 内置模块，不需要 npm install
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT_FILE = path.join(CONTENT_DIR, 'data.js');

/* ------------------------------------------------------------------ */
/* 1. 读取与解析                                                       */
/* ------------------------------------------------------------------ */

/** 读取目录下所有 .md 文件 */
function readMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return { fileName: name, id: name.replace(/\.md$/i, ''), raw: fs.readFileSync(file, 'utf8') };
    });
}

/**
 * 拆出文件头部的 front matter
 * 格式：
 *   ---
 *   title: 标题
 *   date: 2026-10-05
 *   ---
 *
 * 有个坑会反复出现：文件头那三条减号被写成 `\---`（某个编辑器 / 复制粘贴
 * 过来时会自动给 Markdown 符号加转义），行尾还会多出两个空格（Markdown 的
 * 硬换行写法）。这两种写法都是「看起来一模一样、其实整块失效」，页面上的
 * 表现是标题变成文件名、日期空白、正文里冒出一堆 title: year:。
 * 与其让人对着屏幕找，这里直接认掉：先按原样修一条干净的文本再解析。
 */
function normalizeFrontMatter(raw) {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    /* 行首多一个反斜杠的 --- ，连同行尾空格一起去掉 */
    .replace(/^\\---[ \t]*$/gm, '---');
}

function splitFrontMatter(raw) {
  const text = normalizeFrontMatter(raw);
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  match[1].split('\n').forEach((line) => {
    const cut = line.indexOf(':');
    if (cut === -1) return;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    // 去掉首尾成对的引号（title: '---' 这种写坏了的值也在这里被剥掉一层）
    value = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (key) meta[key] = value;
  });

  return { meta, body: text.slice(match[0].length) };
}

/** 行内语法：先转义 HTML，再处理粗体/斜体/代码/图片/链接 */
function renderInline(text) {
  let out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  return out;
}

/** 判断某一行是否会开启一个新的块级元素 */
function isBlockStart(line) {
  return (
    /^\s*#{1,4}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,})\s*$/.test(line)
  );
}

/** 把 Markdown 正文转成 HTML（只支持最常用的几种语法） */
function renderBlocks(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行：跳过
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, '').trim())}</li>`);
        i++;
      }
      html.push(`<ul>\n${items.join('\n')}\n</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, '').trim())}</li>`);
        i++;
      }
      html.push(`<ol>\n${items.join('\n')}\n</ol>`);
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(quoted.join(' '))}</p></blockquote>`);
      continue;
    }

    // 段落：一直吃到空行或下一个块级元素
    const buffer = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buffer.push(lines[i].trim());
      i++;
    }
    if (buffer.length === 0) {
      // 兜底，避免任何意外情况下的死循环
      i++;
      continue;
    }
    html.push(`<p>${renderInline(buffer.join(' '))}</p>`);
  }

  return html.join('\n');
}

/* ------------------------------------------------------------------ */
/* 2. 组织数据结构                                                     */
/* ------------------------------------------------------------------ */

/** 2026-10-05 -> 2026.10.05，用于等宽字体的日期展示 */
function toDisplayDate(value) {
  return String(value || '').replace(/-/g, '.');
}

/**
 * 把 front matter 里的一行图片列表拆成 [{ src, caption }]
 * 写法：photos: photos/a-view.webp, photos/b-view.webp | 一句说明
 * 注意：说明里不要用英文逗号，会被当成分隔符
 */
function parsePhotoList(value) {
  if (!value) return [];

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const cut = item.indexOf('|');
      if (cut === -1) return { src: item, caption: '' };
      return {
        src: item.slice(0, cut).trim(),
        caption: item.slice(cut + 1).trim()
      };
    });
}

function buildPosts() {
  return readMarkdownFiles(path.join(CONTENT_DIR, 'posts'))
    .map((file) => {
      const { meta, body } = splitFrontMatter(file.raw);
      /* 文件头写坏（最常见的是写成 \--- 或者前面多了空行）时不会报错，
         而是悄悄退回「标题=文件名、日期=空」，页面看着像没更新。
         这里主动喊一声，免得人对着屏幕找半天。 */
      if (!meta.title || !meta.date) {
        console.warn(
          `  ! ${file.fileName} 的文件头没读出来，标题会用文件名、日期为空。` +
            '检查第一行是不是 ---（不能是 \\---，前面也不能有空行）'
        );
      }
      return {
        id: file.id,
        title: meta.title || file.id,
        date: meta.date || '',
        displayDate: toDisplayDate(meta.date),
        tag: meta.tag || '随笔',
        summary: meta.summary || '',
        sample: meta.sample === 'true',
        html: renderBlocks(body),
      };
    })
    // 按日期倒序，最新的在最前面
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * 近况：短动态，一条 = 日期 + 一段短文 + 若干照片
 * 文字和照片都可以是空的，但不能两个都空（那种条目没有意义，构建时会提示）
 */
function buildUpdates() {
  return readMarkdownFiles(path.join(CONTENT_DIR, 'updates'))
    .map((file) => {
      const { meta, body } = splitFrontMatter(file.raw);
      const html = renderBlocks(body);
      const photos = parsePhotoList(meta.photos);

      if (!html.trim() && photos.length === 0) {
        console.warn(`  ! ${file.fileName} 既没有文字也没有照片，会被渲染成一条空白`);
      }

      return {
        id: file.id,
        date: meta.date || '',
        displayDate: toDisplayDate(meta.date),
        place: meta.place || '',
        photos,
        sample: meta.sample === 'true',
        html
      };
    })
    // 时间倒序，同一天的新条目在前
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id.localeCompare(a.id));
}

/** 检查 md 里写的图片在盘上到底存不存在。路径写错（漏了 photos/ 前缀、
 *  把 -view.webp 写成 .jpg）在页面上只表现为「图裂了」，很难反查。 */
function warnMissingPhotos(fileName, paths) {
  paths
    .filter(Boolean)
    .forEach((p) => {
      if (!fs.existsSync(path.join(ROOT, p))) {
        console.warn(
          `  ! ${fileName} 引用了 ${p}，但仓库里没有这个文件（多半是漏了 photos/ 前缀，或者名字拼错了）`
        );
      }
    });
}

function buildWorks() {
  return readMarkdownFiles(path.join(CONTENT_DIR, 'works'))
    .map((file) => {
      const { meta, body } = splitFrontMatter(file.raw);
      const photos = parsePhotoList(meta.photos);

      /* 作品必须有个标题，否则卡片上只会显示 work-004 这样的文件名 */
      if (!meta.title) {
        console.warn(`  ! ${file.fileName} 没有 title，卡片上会显示文件名`);
      }
      warnMissingPhotos(file.fileName, [meta.cover].concat(photos.map((p) => p.src)));

      return {
        id: file.id,
        title: meta.title || file.id,
        year: meta.year || '',
        status: meta.status || '进行中',
        summary: meta.summary || '',
        link: meta.link || '',
        /* cover：卡片上那张封面；photos：展开后的一组图 */
        cover: meta.cover || '',
        photos,
        sample: meta.sample === 'true',
        html: renderBlocks(body)
      };
    })
    // 年份新的在前
    .sort((a, b) => String(b.year).localeCompare(String(a.year)) || a.id.localeCompare(b.id));
}

/**
 * 公告：content/announcements/ 下一条公告一个 .md，全部按时间倒序
 *
 * 几个约定：
 *   active: true    这条会弹窗。同一时间只该有一条是 true
 *   id              公告的版本号。访客关掉后浏览器会记住这个 id；
 *                   改一个值，所有人都会再看到一次
 *   tone: alert     顶栏用橘红色（适合「有事要说」的提醒），默认荧光黄
 *
 * 没有 active 的公告不会弹，但仍然留在近况页顶部的「站点公告」存档里，
 * 所以历史公告有地方翻，不会发完就没了。
 */
function buildAnnouncements() {
  return readMarkdownFiles(path.join(CONTENT_DIR, 'announcements'))
    .map((file) => {
      const { meta, body } = splitFrontMatter(file.raw);
      const html = renderBlocks(body);
      const active = meta.active === 'true';

      if (active && !html.trim()) {
        console.warn(`  ! ${file.fileName} 标了 active 但正文为空，弹窗会是一张空白卡片`);
      }

      return {
        id: meta.id || file.id,
        title: meta.title || '公告',
        date: meta.date || '',
        displayDate: toDisplayDate(meta.date),
        tone: meta.tone === 'alert' ? 'alert' : 'normal',
        active,
        sample: meta.sample === 'true',
        html
      };
    })
    // 新公告在前；同一天的按 id 倒序
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id.localeCompare(a.id));
}

/**
 * 从全部公告里挑出「当前该弹的那一条」。
 * 一条都没标 active 就返回 { active: false }，弹窗和页脚按钮都不会出现。
 */
function pickCurrentNotice(list) {
  const actives = list.filter((item) => item.active);
  if (actives.length === 0) return { active: false };

  if (actives.length > 1) {
    console.warn(
      `  ! 有 ${actives.length} 条公告都标了 active: true，只会弹最新的那条（${actives[0].id}）`
    );
  }

  return actives[0];
}

function buildAbout() {
  const file = path.join(CONTENT_DIR, 'about.md');
  if (!fs.existsSync(file)) return { title: '关于', photo: '', sample: false, html: '' };

  const { meta, body } = splitFrontMatter(fs.readFileSync(file, 'utf8'));
  return {
    title: meta.title || '这里是谁',
    photo: meta.photo || '',
    sample: meta.sample === 'true',
    html: renderBlocks(body),
  };
}

/* ------------------------------------------------------------------ */
/* 3. 输出                                                             */
/* ------------------------------------------------------------------ */

function main() {
  const posts = buildPosts();
  const works = buildWorks();
  const updates = buildUpdates();
  const about = buildAbout();
  const notices = buildAnnouncements();
  const announcement = pickCurrentNotice(notices);
  const buildDate = new Date().toISOString().slice(0, 10);

  const output = `/* 本文件由 tools/build-content.js 自动生成，请不要手动修改。
 * 修改内容请去 content/posts/*.md、content/works/*.md、content/updates/*.md、
 * content/announcements/*.md、content/about.md，
 * 然后运行：node tools/build-content.js
 * 生成时间：${buildDate}
 */

window.SITE_BUILD_DATE = ${JSON.stringify(buildDate)};

window.SITE_POSTS = ${JSON.stringify(posts, null, 2)};

window.SITE_WORKS = ${JSON.stringify(works, null, 2)};

window.SITE_UPDATES = ${JSON.stringify(updates, null, 2)};

window.SITE_ABOUT = ${JSON.stringify(about, null, 2)};

/* 全部公告（近况页的「站点公告」存档用，新在前） */
window.SITE_NOTICES = ${JSON.stringify(notices, null, 2)};

/* 当前该弹的那一条；没有 active 公告时是 { active: false } */
window.SITE_ANNOUNCEMENT = ${JSON.stringify(announcement, null, 2)};
`;

  fs.writeFileSync(OUT_FILE, output, 'utf8');

  console.log('内容构建完成：');
  console.log(`  博客 ${posts.length} 篇`);
  console.log(`  近况 ${updates.length} 条`);
  console.log(`  作品 ${works.length} 个`);
  console.log(
    `  公告 ${notices.length} 条` +
      (announcement.active ? `，当前弹「${announcement.title}」` : '，没有标 active 的，不弹窗')
  );
  console.log(`  关于页 ${about.html ? '已生成' : '缺失'}`);
  console.log(`  输出 → ${path.relative(ROOT, OUT_FILE)}`);
}

main();
