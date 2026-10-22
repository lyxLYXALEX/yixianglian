#!/usr/bin/env node
/**
 * 写作台 · 本地服务
 * ==================================================================
 * 一个只跑在本机的小服务（http://127.0.0.1:4321），给 tools/admin/public
 * 里的界面提供接口，负责四件事：
 *
 *   1. 读写 content/ 下的 md（建立、修改、删除）
 *   2. 把拖进来的照片压成 -thumb.webp / -view.webp（复用 sharp，参数和
 *      tools/compress-photos.js 两档完全一致，别在这里另起一套）
 *   3. 调 tools/build-content.js 重建 data.js
 *   4. git add / commit / push
 *
 * 全部只用 Node 内置模块 + tools/node_modules 里的 sharp，不需要 npm install。
 *
 * 启动：双击 tools/admin/start.cmd（它会自己找 Node 并打开浏览器）
 * 停止：关掉那个黑窗口
 * ================================================================== */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

/* ------------------------------------------------------------------ */
/* 0. 路径与依赖                                                       */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, '..', '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PHOTOS_DIR = path.join(ROOT, 'photos');
const RAW_DIR = path.join(ROOT, 'raw');
const ARCHIVE_DIR = path.join(ROOT, 'archive');
const BUILD_SCRIPT = path.join(ROOT, 'tools', 'build-content.js');

/* 复用构建脚本的解析/渲染，保证「预览」和「线上」是同一套规则 */
const build = require(BUILD_SCRIPT);

let sharp = null;
try {
  /* tools/admin 往上找一层就是 tools/node_modules */
  sharp = require('sharp');
} catch (err) {
  console.warn('[提示] 没找到 sharp，照片上传功能会不可用（其它功能正常）。');
  console.warn('       需要的话在 tools 目录里跑一次 npm install。');
}

/* ------------------------------------------------------------------ */
/* 1. 内容类型与字段定义                                               */
/*    —— 界面上的表单是照这份定义自动生成的，加字段只改这里             */
/* ------------------------------------------------------------------ */

const SCHEMA = {
  post: {
    label: '博客',
    icon: '文',
    dir: 'posts',
    prefix: 'post',
    titleField: 'title',
    dateField: 'date',
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true, placeholder: '一句话把这个想法说出来' },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'tag', label: '标签', type: 'text', default: '随笔', placeholder: '随笔' },
      { key: 'summary', label: '摘要', type: 'text', placeholder: '列表上显示的一两句，也可以空着' }
    ],
    body: { label: '正文', rows: 18, placeholder: '支持 # 标题、**粗体**、- 列表、1. 编号、> 引用、`代码`' }
  },

  update: {
    label: '近况',
    icon: '近',
    dir: 'updates',
    prefix: 'update',
    titleField: null,
    dateField: 'date',
    fields: [
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'place', label: '地点', type: 'text', placeholder: '宿舍、图书馆…（不填也行）' },
      { key: 'photos', label: '照片', type: 'photos' }
    ],
    body: { label: '想说的话', rows: 8, placeholder: '不值得单独写成文章的事，就搁这儿。一段话、几张照片，或者只有图没有字。' }
  },

  work: {
    label: '作品',
    icon: '品',
    dir: 'works',
    prefix: 'work',
    titleField: 'title',
    dateField: 'year',
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'year', label: '年份', type: 'text', placeholder: '2025' },
      { key: 'status', label: '状态', type: 'select', options: ['已完成', '半成品', '烂尾'] },
      { key: 'summary', label: '摘要', type: 'text', placeholder: '卡片上那一两句' },
      { key: 'link', label: '链接', type: 'text', placeholder: 'https://…（不填也行）' },
      { key: 'cover', label: '封面', type: 'photo', hint: '卡片上显示的那一张' },
      { key: 'photos', label: '组图', type: 'photos', hint: '点开弹窗里的一组，封面可以重复放' }
    ],
    body: { label: '说明', rows: 12, placeholder: '发生了什么、为什么留下，随便写' }
  },

  notice: {
    label: '公告',
    icon: '告',
    dir: 'announcements',
    prefix: 'notice',
    titleField: 'title',
    dateField: 'date',
    fields: [
      { key: 'active', label: '进站弹窗', type: 'switch', hint: '打开后访客进站会看到这条；同一时间只保留一条' },
      { key: 'id', label: '版本号', type: 'text', required: true, hint: '改一个值，所有人会重新看到一次弹窗' },
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
      { key: 'tone', label: '顶栏颜色', type: 'select', options: ['normal', 'alert'], optionLabels: ['荧光黄（普通）', '橘红（有事要说）'] }
    ],
    body: { label: '正文', rows: 8, placeholder: '公告内容，短一点，弹窗里放不下太多' }
  },

  about: {
    label: '关于页',
    icon: '我',
    dir: null,
    file: 'about.md',
    titleField: 'title',
    fields: [
      { key: 'title', label: '大标题', type: 'text', required: true },
      { key: 'photo', label: '人像', type: 'photo', hint: '关于页左侧那张图' }
    ],
    body: { label: '正文', rows: 14, placeholder: '分段写，空一行就是一个新段落。' }
  }
};

/* front matter 写出时的字段顺序（避免每次保存把文件顺序打乱） */
const META_ORDER = {
  post: ['title', 'date', 'tag', 'summary', 'sample'],
  update: ['date', 'place', 'photos', 'sample'],
  work: ['title', 'year', 'status', 'summary', 'link', 'cover', 'photos', 'sample'],
  notice: ['active', 'id', 'title', 'date', 'tone', 'sample'],
  about: ['title', 'photo', 'sample']
};

/* 两档压缩参数：必须和 tools/compress-photos.js 里的 PROFILES 保持一致 */
const PROFILES = {
  album: { thumb: { edge: 800, quality: 78 }, view: { edge: 1600, quality: 84 } },
  work: { thumb: { edge: 800, quality: 80 }, view: { edge: 2400, quality: 86 } }
};

/* ------------------------------------------------------------------ */
/* 2. 文件读写                                                         */
/* ------------------------------------------------------------------ */

function typeDir(type) {
  const cfg = SCHEMA[type];
  if (!cfg) throw new Error('未知的内容类型：' + type);
  return path.join(CONTENT_DIR, cfg.dir);
}

function itemFile(type, id) {
  const cfg = SCHEMA[type];
  if (cfg.file) return path.join(CONTENT_DIR, cfg.file);
  return path.join(CONTENT_DIR, cfg.dir, id + '.md');
}

function listIds(type) {
  const cfg = SCHEMA[type];
  if (cfg.file) return cfg.file && fs.existsSync(path.join(CONTENT_DIR, cfg.file)) ? ['about'] : [];
  const dir = typeDir(type);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.md'))
    .sort()
    .map((n) => n.replace(/\.md$/i, ''));
}

/** 下一个可用编号：post-001 → post-002 */
function nextId(type) {
  const cfg = SCHEMA[type];
  const dir = typeDir(type);
  let max = 0;
  listIds(type).forEach((id) => {
    const m = id.match(new RegExp('^' + cfg.prefix + '-(\\d+)$', 'i'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return cfg.prefix + '-' + String(max + 1).padStart(3, '0');
}

function readItem(type, id) {
  const file = itemFile(type, id);
  if (!fs.existsSync(file)) throw new Error('找不到文件：' + path.relative(ROOT, file));
  const raw = fs.readFileSync(file, 'utf8');
  const { meta, body } = build.splitFrontMatter(raw);
  return { type, id, file, meta, body: body.replace(/^\n+/, '').replace(/\s+$/, '') };
}

/**
 * 把 meta 对象写成干净的 front matter。
 * 这里必须用最朴素的写法 —— 带引号的 title、行尾两个空格、`\---` 这些
 * 都曾经把内容搞坏过（见 README 的排查清单）。
 */
function serializeMeta(type, meta) {
  const order = META_ORDER[type] || [];
  const keys = order.filter((k) => k in meta).concat(Object.keys(meta).filter((k) => !order.includes(k)));

  const lines = ['---'];
  keys.forEach((k) => {
    const v = meta[k];
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    /* 空值直接不写这一行，免得留下 `place:` 这种空字段 */
    if (s === '' && k !== 'active') return;
    lines.push(k + ': ' + s);
  });
  lines.push('---');
  return lines;
}

function writeItem(type, id, meta, body) {
  const file = itemFile(type, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = serializeMeta(type, meta).join('\n');
  const text = head + '\n\n' + String(body || '').replace(/\r\n/g, '\n').trim() + '\n';
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** 把「一行照片列表」格式化出来：photos/a-view.webp | 说明, photos/b-view.webp */
function serializePhotos(list) {
  return (list || [])
    .filter((p) => p && p.src)
    .map((p) => {
      /* 图注里不能有英文逗号，否则会被当成分隔符 —— 自动换成中文逗号 */
      const caption = String(p.caption || '')
        .replace(/,/g, '，')
        .trim();
      return caption ? p.src + ' | ' + caption : p.src;
    })
    .join(', ');
}

/* ------------------------------------------------------------------ */
/* 3. 照片压缩                                                         */
/* ------------------------------------------------------------------ */

function slugify(name) {
  const base = path.basename(String(name || ''), path.extname(String(name || '')));
  let s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length < 3) {
    const d = new Date();
    s =
      'p' +
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') +
      '-' +
      Math.random().toString(36).slice(2, 6);
  }
  return s.slice(0, 40);
}

async function savePhoto(filename, base64, profileKey) {
  if (!sharp) throw new Error('这台机器上没装 sharp，暂时不能压照片');

  const profile = PROFILES[profileKey] || PROFILES.album;
  const buf = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new Error('照片是空的，重新拖一次试试');

  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  /* 同名保护：重名就加 -2、-3 */
  const slug = slugify(filename);
  let base = slug;
  let n = 2;
  while (fs.existsSync(path.join(PHOTOS_DIR, base + '-view.webp'))) {
    base = slug + '-' + n++;
  }

  const tmp = path.join(RAW_DIR, base + (path.extname(filename).toLowerCase() || '.jpg'));
  fs.writeFileSync(tmp, buf);

  try {
    await sharp(tmp)
      .rotate()
      .resize({ width: profile.thumb.edge, height: profile.thumb.edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: profile.thumb.quality, effort: 5 })
      .toFile(path.join(PHOTOS_DIR, base + '-thumb.webp'));

    const info = await sharp(tmp)
      .rotate()
      .resize({ width: profile.view.edge, height: profile.view.edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: profile.view.quality, effort: 5 })
      .toFile(path.join(PHOTOS_DIR, base + '-view.webp'));

    /* 原图挪进 archive/，不进仓库 */
    fs.renameSync(tmp, path.join(ARCHIVE_DIR, path.basename(tmp)));

    const viewBytes = fs.statSync(path.join(PHOTOS_DIR, base + '-view.webp')).size;
    const thumbBytes = fs.statSync(path.join(PHOTOS_DIR, base + '-thumb.webp')).size;

    return {
      src: 'photos/' + base + '-view.webp',
      thumb: 'photos/' + base + '-thumb.webp',
      width: info.width,
      height: info.height,
      bytes: viewBytes + thumbBytes,
      originalBytes: buf.length
    };
  } catch (err) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw new Error('照片压不动：' + err.message);
  }
}

/* ------------------------------------------------------------------ */
/* 4. 构建 + git                                                       */
/* ------------------------------------------------------------------ */

function findGit() {
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'git';
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: (opts && opts.cwd) || ROOT,
        windowsHide: true,
        env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
      });
    } catch (err) {
      resolve({ code: -1, out: err.message });
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', (err) => resolve({ code: -1, out: out + err.message }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

function isGitRepo() {
  return fs.existsSync(path.join(ROOT, '.git'));
}

/** 当前 git 状态，给界面右上角显示 */
async function gitStatus() {
  if (!isGitRepo()) return { repo: false };
  const git = findGit();
  const branch = await run(git, ['branch', '--show-current']);
  const status = await run(git, ['status', '--porcelain']);
  const last = await run(git, ['log', '-1', '--pretty=%h|%s|%ad', '--date=format:%Y-%m-%d %H:%M']);
  const ahead = await run(git, ['rev-list', '--count', '@{u}..HEAD']);

  const changed = String(status.out || '')
    .split('\n')
    .filter(Boolean);

  const [hash, subject, when] = String(last.out || '').trim().split('|');

  return {
    repo: true,
    branch: String(branch.out || '').trim() || '(未命名)',
    changed: changed.length,
    changedFiles: changed.slice(0, 40).map((l) => l.trim()),
    ahead: parseInt(String(ahead.out || '0').trim(), 10) || 0,
    last: hash ? { hash, subject, when } : null
  };
}

/* 发布任务：构建 → add → commit → push，边跑边把输出推给界面 */
let jobSeq = 0;
const jobs = new Map();

function pushLine(job, stage, text) {
  String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .forEach((line) => {
      if (line.trim()) job.lines.push({ stage, text: line });
    });
}

function startPublish(message) {
  const id = String(++jobSeq);
  const job = { id, done: false, ok: false, lines: [], startedAt: Date.now() };
  jobs.set(id, job);

  (async () => {
    const node = process.execPath;
    const git = findGit();
    const msg =
      String(message || '').trim() ||
      '更新内容 · ' +
        new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');

    try {
      /* 1. 构建 */
      job.stage = 'build';
      pushLine(job, 'build', '$ node tools/build-content.js');
      const b = await run(node, [BUILD_SCRIPT]);
      pushLine(job, 'build', b.out);
      if (b.code !== 0) throw new Error('构建失败，上面是详细输出');

      if (!isGitRepo()) {
        /* 没有 git 仓库就只构建，不留半截发布 */
        job.stage = 'done';
        job.ok = true;
        job.warning = '这个文件夹还不是 git 仓库，只做了构建，没有提交';
        pushLine(job, 'done', '提示：没有 .git，跳过了提交与推送');
        job.done = true;
        return;
      }

      /* 2. 提交 */
      job.stage = 'commit';
      pushLine(job, 'commit', '$ git add -A');
      const add = await run(git, ['add', '-A']);
      pushLine(job, 'commit', add.out);

      const st = await run(git, ['status', '--porcelain']);
      if (!String(st.out || '').trim()) {
        pushLine(job, 'commit', '没有文件改动，跳过提交');
      } else {
        pushLine(job, 'commit', '$ git commit -m "' + msg + '"');
        const c = await run(git, ['commit', '-m', msg]);
        pushLine(job, 'commit', c.out);
        if (c.code !== 0) throw new Error('提交失败（常见原因：git 没设置 user.name / user.email）');
      }

      /* 3. 推送 */
      job.stage = 'push';
      pushLine(job, 'push', '$ git push');
      const p = await run(git, ['push']);
      pushLine(job, 'push', p.out || '（没有输出，通常就是成功了）');
      if (p.code !== 0) throw new Error('推送失败，检查网络或 GitHub 登录状态');

      job.stage = 'done';
      pushLine(job, 'done', '✓ 已发布。GitHub Pages 大约 1 分钟后自动更新，线上地址不变。');
      job.ok = true;
    } catch (err) {
      job.error = err.message;
      pushLine(job, 'error', '✗ ' + err.message);
    } finally {
      job.done = true;
    }
  })();

  return id;
}

/* ------------------------------------------------------------------ */
/* 5. 索引：给界面左侧列表用                                           */
/* ------------------------------------------------------------------ */

function buildIndex() {
  const posts = fs.existsSync(path.join(CONTENT_DIR, 'posts')) ? build.buildPosts() : [];
  const updates = fs.existsSync(path.join(CONTENT_DIR, 'updates')) ? build.buildUpdates() : [];
  const works = fs.existsSync(path.join(CONTENT_DIR, 'works')) ? build.buildWorks() : [];
  const notices = fs.existsSync(path.join(CONTENT_DIR, 'announcements')) ? build.buildAnnouncements() : [];

  return {
    post: posts.map((p) => ({
      id: p.id,
      title: p.title,
      date: p.displayDate,
      sub: p.summary || p.tag,
      sample: p.sample
    })),
    update: updates.map((u) => ({
      id: u.id,
      title: u.html ? stripTags(u.html).slice(0, 40) : '（只有照片）',
      date: u.displayDate,
      sub: u.place || (u.photos.length ? u.photos.length + ' 张照片' : ''),
      sample: u.sample
    })),
    work: works.map((w) => ({
      id: w.id,
      title: w.title,
      date: w.year,
      sub: w.status,
      sample: w.sample
    })),
    notice: notices.map((n) => ({
      id: n.id,
      title: n.title,
      date: n.displayDate,
      sub: n.active ? '正在弹窗' : '已归档',
      active: n.active,
      sample: n.sample
    })),
    about: fs.existsSync(path.join(CONTENT_DIR, 'about.md'))
      ? [{ id: 'about', title: build.buildAbout().title, date: '', sub: '' }]
      : []
  };
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* 6. HTTP 小工具                                                      */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 48 * 1024 * 1024)) {
        reject(new Error('上传的内容太大了'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('请求格式不对'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ */
/* 7. 路由                                                             */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname;

  /* ---- 读 ---- */
  if (p === '/api/state' && req.method === 'GET') {
    const git = await gitStatus();
    return sendJson(res, 200, {
      schema: Object.keys(SCHEMA).map((k) => Object.assign({ type: k }, SCHEMA[k])),
      index: buildIndex(),
      git
    });
  }

  if (p === '/api/item' && req.method === 'GET') {
    const type = url.searchParams.get('type');
    const id = url.searchParams.get('id');
    const item = readItem(type, id);
    return sendJson(res, 200, {
      type,
      id,
      meta: item.meta,
      body: item.body
    });
  }

  if (p === '/api/new-id' && req.method === 'GET') {
    const type = url.searchParams.get('type');
    return sendJson(res, 200, { id: nextId(type) });
  }

  if (p === '/api/photos' && req.method === 'GET') {
    const list = fs.existsSync(PHOTOS_DIR)
      ? fs
          .readdirSync(PHOTOS_DIR)
          .filter((n) => /-view\.webp$/i.test(n))
          .sort()
          .map((n) => 'photos/' + n)
      : [];
    return sendJson(res, 200, { photos: list });
  }

  if (p === '/api/git' && req.method === 'GET') {
    return sendJson(res, 200, await gitStatus());
  }

  /* ---- 写 ---- */
  if (p === '/api/preview' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { html: build.renderBlocks(String(body.body || '')) });
  }

  if (p === '/api/save' && req.method === 'POST') {
    const data = await readBody(req);
    const type = data.type;
    const cfg = SCHEMA[type];
    if (!cfg) throw new Error('未知的内容类型');

    const warnings = [];
    const meta = {};

    /* 先继承原有文件头（这样 sample、以及将来新增的字段不会莫名丢失） */
    let existingMeta = {};
    if (data.id && fs.existsSync(itemFile(type, data.id))) {
      existingMeta = readItem(type, data.id).meta;
    }
    Object.assign(meta, existingMeta);

    (cfg.fields || []).forEach((f) => {
      const raw = data.meta ? data.meta[f.key] : undefined;
      if (f.type === 'photos') {
        meta[f.key] = serializePhotos(raw || []);
      } else if (f.type === 'switch') {
        meta[f.key] = raw ? 'true' : 'false';
      } else if (f.type === 'photo') {
        meta[f.key] = String(raw || '').trim();
      } else {
        meta[f.key] = String(raw === undefined || raw === null ? '' : raw).trim();
      }
    });

    /* 必填校验 */
    const missing = (cfg.fields || [])
      .filter((f) => f.required && !meta[f.key])
      .map((f) => f.label);
    if (missing.length) throw new Error('还差：' + missing.join('、'));

    /* 公告只允许一条 active */
    if (type === 'notice' && meta.active === 'true') {
      listIds('notice').forEach((otherId) => {
        if (otherId === data.id) return;
        const other = readItem('notice', otherId);
        if (other.meta.active === 'true') {
          other.meta.active = 'false';
          writeItem('notice', otherId, other.meta, other.body);
          warnings.push('已把另一条公告「' + (other.meta.title || otherId) + '」的弹窗关掉');
        }
      });
    }

    /* 示例标记：界面上取消勾选就删掉这一行 */
    if (data.removeSample) delete meta.sample;

    const id = data.id || nextId(type);
    const file = writeItem(type, id, meta, data.body);

    return sendJson(res, 200, {
      ok: true,
      id,
      file: path.relative(ROOT, file),
      warnings
    });
  }

  if (p === '/api/delete' && req.method === 'POST') {
    const data = await readBody(req);
    const cfg = SCHEMA[data.type];
    if (!cfg || cfg.file) throw new Error('这一项不能删除');
    const file = itemFile(data.type, data.id);
    if (!fs.existsSync(file)) throw new Error('文件已经不在了');
    fs.unlinkSync(file);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const data = await readBody(req);
    const photo = await savePhoto(data.filename, data.data, data.profile);
    return sendJson(res, 200, photo);
  }

  if (p === '/api/publish' && req.method === 'POST') {
    const data = await readBody(req);
    return sendJson(res, 200, { jobId: startPublish(data.message) });
  }

  if (p === '/api/job' && req.method === 'GET') {
    const job = jobs.get(url.searchParams.get('id'));
    if (!job) return sendJson(res, 404, { error: '任务不存在' });
    return sendJson(res, 200, {
      id: job.id,
      done: job.done,
      ok: job.ok,
      stage: job.stage,
      lines: job.lines.slice(-400),
      error: job.error || '',
      warning: job.warning || ''
    });
  }

  return sendJson(res, 404, { error: '没有这个接口：' + p });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  /* 只服务本机：挡掉别处发来的跨站请求 */
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return sendJson(res, 403, { error: '只接受本机请求' });
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    /* 照片预览：/p/<文件名> */
    if (url.pathname.startsWith('/p/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice(3)));
      if (!/^[\w.\-]+$/.test(name)) {
        res.writeHead(400).end('bad name');
        return;
      }
      return serveStatic(res, path.join(PHOTOS_DIR, name));
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    return serveStatic(res, file);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || String(err) });
  }
});

/* ------------------------------------------------------------------ */
/* 8. 启动                                                             */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT || 4321);

function openBrowser(url) {
  /* 用系统默认浏览器打开，不依赖任何 npm 包。
     调试时不想要弹窗，启动前设 NO_OPEN=1 即可。 */
  if (process.env.NO_OPEN) return;
  try {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (err) {
    console.log('没能自动打开浏览器，请手动访问：' + url);
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('\n端口 ' + PORT + ' 已经被占用了。');
    console.log('多半是写作台已经在另一个窗口里开着 —— 直接去浏览器打开 ' + 'http://127.0.0.1:' + PORT + ' 就行。');
    console.log('如果确定不是，把 PORT 环境变量换一个数字再启动。\n');
  } else {
    console.log('\n启动失败：' + err.message + '\n');
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/';
  console.log('');
  console.log('  自留地 · 写作台');
  console.log('  ' + url);
  console.log('');
  console.log('  内容目录：' + CONTENT_DIR);
  console.log('  照片目录：' + PHOTOS_DIR);
  console.log('');
  console.log('  这个窗口关掉，写作台就停了。');
  console.log('');
  openBrowser(url);
});
