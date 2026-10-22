/**
 * 自留地 · 写作台 —— 前端逻辑
 * ------------------------------------------------------------------
 * 全是原生 JS，没有依赖、没有构建步骤。改完刷新页面就生效。
 *
 * 数据流：
 *   启动 → GET /api/state（拿到字段定义、列表、git 状态）
 *   选中一条 → GET /api/item（拿到文件头 + 正文原文）
 *   保存 → POST /api/save（顺手重建 data.js 之外什么都不做）
 *   发布 → POST /api/publish（构建 + commit + push），再轮询 /api/job 取日志
 *
 * 唯一的约定：draft.meta 里的 photos 是数组 [{src, caption}]，
 * 其它字段都是字符串；后端负责把它们拼成 front matter 的一行。
 */

'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  schema: [],
  index: {},
  git: null,
  type: 'post',
  draft: null, // { id, meta, body, isNew, removeSample }
  dirty: false,
  busy: false,
  logShown: 0
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach((key) => {
      const val = props[key];
      if (val === undefined || val === null) return;
      if (key === 'class') node.className = val;
      else if (key === 'text') node.textContent = val;
      else if (key === 'html') node.innerHTML = val;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === 'checked' || key === 'hidden' || key === 'disabled') node[key] = !!val;
      else node.setAttribute(key, val);
    });
  }
  kids
    .flat(4)
    .forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    });
  return node;
}

async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  const res = await fetch(path, opts);
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('服务返回的内容看不懂（HTTP ' + res.status + '）');
  }
  if (!res.ok || data.error) throw new Error(data.error || '请求失败（HTTP ' + res.status + '）');
  return data;
}

let toastTimer = 0;
function toast(msg, bad) {
  const box = $('#toast');
  box.textContent = msg;
  box.className = 'toast' + (bad ? ' bad' : '');
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, bad ? 6000 : 2600);
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function currentCfg() {
  return state.schema.find((s) => s.type === state.type);
}

/** photos/x-view.webp → /p/x-thumb.webp（列表里用小图，省得每次都拉大图） */
function thumbUrl(src) {
  const name = String(src || '').split('/').pop();
  const thumb = name.replace(/-view\.webp$/i, '-thumb.webp');
  return '/p/' + encodeURIComponent(thumb);
}

function parsePhotos(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const cut = item.indexOf('|');
      if (cut === -1) return { src: item, caption: '' };
      return { src: item.slice(0, cut).trim(), caption: item.slice(cut + 1).trim() };
    });
}

function markDirty() {
  state.dirty = true;
  const badge = $('.editor-head .dirty');
  if (badge) badge.hidden = false;
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const data = await api('/api/state');
    state.schema = data.schema;
    state.index = data.index;
    state.git = data.git;
  } catch (err) {
    $('#main').className = 'main';
    $('#main').innerHTML =
      '<div class="fatal"><h2>连不上本地服务</h2>' +
      '<p>写作台的服务没在跑，或者中途被关掉了。关掉这个页面，重新双击 <code>tools\\admin\\start.cmd</code> 再试。</p>' +
      '<pre>' + String(err.message).replace(/[<>&]/g, '') + '</pre></div>';
    return;
  }

  renderTabs();
  renderGit();

  /* 支持 #update / #work 这种深链，刷新页面也停在同一类内容上 */
  const wanted = location.hash.replace('#', '');
  if (wanted && state.schema.some((s) => s.type === wanted)) state.type = wanted;
  renderTabs();

  openFirst();

  $('#new').addEventListener('click', () => newItem());
  $('#refresh').addEventListener('click', () => refreshAll(true));
  $('#publish').addEventListener('click', publish);
  $('#log-close').addEventListener('click', () => {
    $('#logbar').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (state.draft) save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  state.schema.forEach((cfg) => {
    const btn = el('button', { type: 'button', text: cfg.label, 'aria-pressed': String(cfg.type === state.type) });
    btn.addEventListener('click', () => {
      if (state.type === cfg.type) return;
      if (!confirmLeave()) return;
      state.type = cfg.type;
      location.hash = cfg.type;
      renderTabs();
      openFirst();
    });
    nav.appendChild(btn);
  });
}

function renderGit() {
  const box = $('#gitinfo');
  const g = state.git || {};
  if (!g.repo) {
    box.textContent = '这个文件夹还不是 git 仓库 —— 发布时只会构建，不会推送';
    return;
  }
  box.innerHTML = '';
  box.appendChild(el('b', { text: g.branch }));
  box.appendChild(document.createTextNode(' · '));
  box.appendChild(
    el('span', { text: g.changed ? g.changed + ' 个文件待提交' : '没有未提交的改动' })
  );
  if (g.ahead) {
    box.appendChild(document.createTextNode(' · '));
    box.appendChild(el('span', { text: g.ahead + ' 个提交还没推送' }));
  }
  if (g.last) {
    box.appendChild(document.createTextNode(' · 上次：'));
    box.appendChild(el('span', { text: g.last.subject + '（' + g.last.when + '）' }));
  }
}

function confirmLeave() {
  if (!state.dirty) return true;
  return window.confirm('这条还没保存，确定要离开？');
}

function openFirst() {
  const list = state.index[state.type] || [];
  $('#list-title').textContent = currentCfg().label + ' · ' + list.length + ' 条';
  renderList(null);

  if (state.type === 'about' || list.length === 0) {
    if (state.type === 'about' && list.length) openItem('about');
    else blankEditor();
    return;
  }
  openItem(list[0].id);
}

function renderList(activeId) {
  const ul = $('#list');
  ul.innerHTML = '';
  const list = state.index[state.type] || [];

  if (!list.length) {
    ul.appendChild(el('li', { class: 'empty', text: '还没有内容，点右上角「+ 新建」' }));
    return;
  }

  list.forEach((item) => {
    const btn = el('button', { type: 'button' });
    if (item.id === activeId) btn.setAttribute('aria-current', 'true');

    btn.appendChild(
      el('div', { class: 'row1' },
        el('span', { class: 'title' },
          el('span', { text: item.title || item.id }),
          item.sample ? el('span', { class: 'badge', text: '示例' }) : null
        ),
        el('span', { class: 'date', text: item.date || '' })
      )
    );
    if (item.sub) btn.appendChild(el('div', { class: 'sub', text: item.sub }));

    btn.addEventListener('click', () => {
      if (state.draft && state.draft.id === item.id) return;
      if (!confirmLeave()) return;
      openItem(item.id);
    });
    ul.appendChild(btn);
  });
}

async function refreshAll(showToast) {
  const data = await api('/api/state');
  state.schema = data.schema;
  state.index = data.index;
  state.git = data.git;
  renderGit();
  $('#list-title').textContent = currentCfg().label + ' · ' + (state.index[state.type] || []).length + ' 条';
  renderList(state.draft ? state.draft.id : null);
  if (showToast) toast('已重新读取磁盘内容');
}

/* ------------------------------------------------------------------ */
/* 打开 / 新建                                                         */
/* ------------------------------------------------------------------ */

async function openItem(id) {
  try {
    const data = await api('/api/item?type=' + encodeURIComponent(state.type) + '&id=' + encodeURIComponent(id));
    state.draft = {
      id: data.id,
      meta: Object.assign({}, data.meta, {
        photos: data.meta.photos !== undefined ? parsePhotos(data.meta.photos) : []
      }),
      body: data.body || '',
      isNew: false,
      removeSample: false
    };
    state.dirty = false;
    renderList(id);
    renderEditor();
  } catch (err) {
    toast(err.message, true);
  }
}

async function newItem() {
  if (!confirmLeave()) return;
  const cfg = currentCfg();

  if (state.type === 'about') {
    /* 关于页是单独一个文件，没有编号。文件被删掉时也要能从这儿重新建一个 */
    state.draft = {
      id: 'about',
      meta: { title: '关于这块地', photo: '' },
      body: '',
      isNew: true,
      removeSample: false
    };
    state.dirty = true;
    renderList(null);
    renderEditor();

    return;
  }

  let id = cfg.prefix + '-001';
  try {
    const r = await api('/api/new-id?type=' + encodeURIComponent(state.type));
    id = r.id;
  } catch (err) {
    /* 拿不到编号也不至于卡住，后端保存时会再算一次 */
  }

  const meta = {};
  cfg.fields.forEach((f) => {
    if (f.type === 'photos') meta[f.key] = [];
    else if (f.type === 'switch') meta[f.key] = 'false';
    else if (f.type === 'date') meta[f.key] = today();
    else if (f.default) meta[f.key] = f.default;
    else if (f.type === 'select') meta[f.key] = f.options[0];
    else meta[f.key] = '';
  });

  if (state.type === 'work') meta.status = '半成品';

  /* 公告的 id 是「版本号」，要写进文件头；其它类型由后端分配编号，不写 */
  if (state.type === 'notice') {
    meta.id = id;
    meta.tone = 'normal';
  }

  state.draft = { id: null, meta, body: '', isNew: true, removeSample: false };
  state.dirty = true;
  renderList(null);
  renderEditor();
}

function blankEditor() {
  state.draft = null;
  state.dirty = false;
  const main = $('#main');
  main.className = 'main empty';
  main.innerHTML = '';
  main.appendChild(el('div', { text: '左边选一条，或者点「+ 新建」' }));
}

/* ------------------------------------------------------------------ */
/* 编辑界面                                                            */
/* ------------------------------------------------------------------ */

function renderEditor() {
  const cfg = currentCfg();
  const draft = state.draft;
  if (!draft) return blankEditor();

  const main = $('#main');
  main.className = 'main';
  main.innerHTML = '';

  /* —— 标题栏 —— */
  const head = el('div', { class: 'editor-head' });
  const where = draft.isNew
    ? '保存后会写进 content/'
    : cfg.dir
      ? 'content/' + cfg.dir + '/'
      : 'content/about.md';
  head.appendChild(
    el('h2', {},
      el('span', { text: cfg.label + ' · ' + (draft.id || '新建') }),
      el('span', { class: 'path', text: where }),
      el('span', { class: 'dirty', hidden: !state.dirty, text: '· 未保存' })
    )
  );

  const actions = el('div', { class: 'head-actions' });
  actions.appendChild(el('button', { class: 'primary', type: 'button', text: '保存', onclick: save }));
  if (!draft.isNew || draft.id) {
    actions.appendChild(el('button', { class: 'ghost', type: 'button', text: '删除', onclick: removeItem }));
  }
  actions.appendChild(el('button', { class: 'ghost', type: 'button', text: '重新读取', onclick: () => { if (confirmLeave()) refreshAndReopen(); } }));
  head.appendChild(actions);
  main.appendChild(head);

  /* —— 字段 —— */
  const fields = el('div', { class: 'fields' });
  cfg.fields.forEach((f) => {
    const wide = f.type === 'photos' || f.type === 'photo';
    const box = el('div', { class: 'field' + (wide ? ' wide' : '') });
    box.appendChild(el('label', { text: f.label + (f.required ? ' *' : '') }));
    box.appendChild(renderControl(f));
    if (f.hint) box.appendChild(el('div', { class: 'hint', text: f.hint }));
    fields.appendChild(box);
  });
  main.appendChild(fields);

  /* —— 正文 —— */
  const bodyBlock = el('div', { class: 'body-block' });
  const bodyHead = el('div', { class: 'body-head' },
    el('span', { class: 'label', text: cfg.body.label || '正文' })
  );
  const bodyActions = el('div', { class: 'body-actions' });
  const previewBtn = el('button', { class: 'mini ghost', type: 'button', text: '预览' });
  bodyActions.appendChild(previewBtn);
  bodyHead.appendChild(bodyActions);

  const ta = el('textarea', { rows: String(cfg.body.rows || 14), placeholder: cfg.body.placeholder || '' });
  ta.value = draft.body || '';
  ta.addEventListener('input', () => {
    draft.body = ta.value;
    markDirty();
  });

  const preview = el('div', { class: 'preview', hidden: true });
  previewBtn.addEventListener('click', async () => {
    if (preview.hidden) {
      try {
        const r = await api('/api/preview', { body: draft.body });
        preview.innerHTML = r.html || '<p style="color:#999">（正文是空的）</p>';
        /* 正文里引用的相对路径图片，预览时改走本地服务 */
        Array.prototype.forEach.call(preview.querySelectorAll('img'), (img) => {
          const src = img.getAttribute('src') || '';
          if (src.startsWith('photos/')) img.src = thumbUrl(src);
        });
        preview.hidden = false;
        previewBtn.textContent = '收起预览';
      } catch (err) {
        toast(err.message, true);
      }
    } else {
      preview.hidden = true;
      previewBtn.textContent = '预览';
    }
  });

  bodyBlock.appendChild(bodyHead);
  bodyBlock.appendChild(ta);
  bodyBlock.appendChild(preview);
  main.appendChild(bodyBlock);

  /* 示例标记：只在文件本来就有 sample 的时候才让人取消 */
  if (draft.meta.sample === 'true') {
    const note = el('div', { class: 'field' },
      el('label', { text: '示例标记' }),
      el('label', { class: 'switch' },
        (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !draft.removeSample;
          cb.addEventListener('change', () => {
            draft.removeSample = !cb.checked;
            markDirty();
          });
          return cb;
        })(),
        el('span', { class: 'track' }),
        el('span', { class: 'label', text: '保留「示例」角标（换成真实内容后建议关掉）' })
      )
    );
    main.appendChild(note);
  }
}

function renderControl(f) {
  const draft = state.draft;

  if (f.type === 'text') {
    const input = el('input', { type: 'text', placeholder: f.placeholder || '' });
    input.value = draft.meta[f.key] || '';
    input.addEventListener('input', () => {
      draft.meta[f.key] = input.value;
      markDirty();
    });
    return input;
  }

  if (f.type === 'date') {
    const input = el('input', { type: 'date' });
    const val = String(draft.meta[f.key] || '').trim();
    input.value = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : '';
    input.addEventListener('input', () => {
      draft.meta[f.key] = input.value;
      markDirty();
    });
    return input;
  }

  if (f.type === 'select') {
    const sel = el('select');
    f.options.forEach((opt, i) => {
      const o = el('option', { value: opt, text: (f.optionLabels && f.optionLabels[i]) || opt });
      sel.appendChild(o);
    });
    sel.value = draft.meta[f.key] || f.options[0];
    sel.addEventListener('change', () => {
      draft.meta[f.key] = sel.value;
      markDirty();
    });
    return sel;
  }

  if (f.type === 'switch') {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = draft.meta[f.key] === 'true';
    cb.addEventListener('change', () => {
      draft.meta[f.key] = cb.checked ? 'true' : 'false';
      markDirty();
    });
    return el('label', { class: 'switch' },
      cb,
      el('span', { class: 'track' }),
      el('span', { class: 'label', text: '访客进站时弹出这条公告' })
    );
  }

  if (f.type === 'photo') return renderSinglePhoto(f);
  if (f.type === 'photos') return renderMultiPhotos(f);
  return el('div', { text: '（不认识的字段类型：' + f.type + '）' });
}

/* ---------- 单张照片 ---------- */

function renderSinglePhoto(f) {
  const draft = state.draft;
  const box = el('div', { class: 'single-photo' });
  const src = draft.meta[f.key] || '';

  if (src) {
    box.appendChild(el('img', { src: thumbUrl(src), alt: '' }));
  } else {
    box.appendChild(el('div', {
      style: 'width:110px;height:110px;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px',
      text: '还没选'
    }));
  }

  const meta = el('div', { class: 'meta' });
  meta.appendChild(el('div', { class: 'name', text: src || '（空）' }));

  const btns = el('div', { class: 'row-actions' });
  const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });

  btns.appendChild(el('button', {
    class: 'mini', type: 'button', text: src ? '换一张' : '上传照片',
    onclick: () => file.click()
  }));
  if (src) {
    btns.appendChild(el('button', {
      class: 'mini ghost', type: 'button', text: '移除',
      onclick: () => {
        draft.meta[f.key] = '';
        markDirty();
        renderEditor();
      }
    }));
  }
  meta.appendChild(btns);
  meta.appendChild(file);

  const status = el('div', { class: 'uploading', text: '' });
  meta.appendChild(status);

  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    await uploadOne(picked, status, (result) => {
      draft.meta[f.key] = result.src;
      markDirty();
      renderEditor();
    });
  });

  box.appendChild(meta);
  return box;
}

/* ---------- 多张照片 ---------- */

function renderMultiPhotos(f) {
  const draft = state.draft;
  if (!Array.isArray(draft.meta[f.key])) draft.meta[f.key] = parsePhotos(draft.meta[f.key]);
  const list = draft.meta[f.key];

  const box = el('div', { class: 'photos' });
  const status = el('div', { class: 'uploading', text: '' });

  list.forEach((photo, index) => {
    const row = el('div', { class: 'photo-row' });
    row.appendChild(el('img', { src: thumbUrl(photo.src), alt: '' }));

    const meta = el('div', { class: 'meta' });
    meta.appendChild(el('div', { class: 'name', text: photo.src }));

    const cap = el('input', { type: 'text', placeholder: '图注（可不填，别用英文逗号）' });
    cap.value = photo.caption || '';
    cap.addEventListener('input', () => {
      photo.caption = cap.value;
      markDirty();
    });
    meta.appendChild(cap);

    const btns = el('div', { class: 'row-actions' });
    btns.appendChild(el('button', {
      class: 'mini', type: 'button', text: '上移', disabled: index === 0,
      onclick: () => {
        list.splice(index - 1, 0, list.splice(index, 1)[0]);
        markDirty();
        renderEditor();
      }
    }));
    btns.appendChild(el('button', {
      class: 'mini', type: 'button', text: '下移', disabled: index === list.length - 1,
      onclick: () => {
        list.splice(index + 1, 0, list.splice(index, 1)[0]);
        markDirty();
        renderEditor();
      }
    }));
    btns.appendChild(el('button', {
      class: 'mini danger', type: 'button', text: '移除',
      onclick: () => {
        list.splice(index, 1);
        markDirty();
        renderEditor();
      }
    }));
    meta.appendChild(btns);

    row.appendChild(meta);
    box.appendChild(row);
  });

  /* 拖放区 */
  const file = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });
  const drop = el('div', { class: 'dropzone' },
    el('strong', { text: '把照片拖到这里' }),
    el('span', { text: '　或者点击选择文件（可多选）' })
  );

  const addFiles = async (files) => {
    const arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    for (let i = 0; i < arr.length; i++) {
      status.textContent = '正在压第 ' + (i + 1) + '/' + arr.length + ' 张…';
      await uploadOne(arr[i], status, (result) => {
        list.push({ src: result.src, caption: '' });
        markDirty();
      }, true);
    }
    status.textContent = '';
    renderEditor();
  };

  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => addFiles(file.files));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  box.appendChild(drop);
  box.appendChild(file);
  box.appendChild(status);
  return box;
}

/* ---------- 上传 ---------- */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('这个文件读不出来'));
    reader.readAsDataURL(file);
  });
}

async function uploadOne(file, statusNode, onDone, quiet) {
  const name = String(file.name || '').toLowerCase();
  if (/\.(heic|heif)$/.test(name)) {
    toast('iPhone 的 HEIC 压不了，先在相册里导出成 JPG 再拖进来', true);
    return;
  }
  if (!/^image\//.test(file.type || '')) {
    toast(file.name + ' 不是图片', true);
    return;
  }

  if (statusNode) statusNode.textContent = '读取中…';
  try {
    const dataUrl = await readAsDataUrl(file);
    if (statusNode) statusNode.textContent = '压图中…';
    const result = await api('/api/upload', {
      filename: file.name,
      data: dataUrl,
      profile: state.type === 'work' ? 'work' : 'album'
    });
    if (statusNode) statusNode.textContent = '';
    if (!quiet) {
      const saved = result.originalBytes
        ? Math.round((result.bytes / result.originalBytes) * 100)
        : 0;
      toast('已压好：' + result.width + '×' + result.height + '，体积约原来的 ' + saved + '%');
    }
    onDone(result);
  } catch (err) {
    if (statusNode) statusNode.textContent = '';
    toast(err.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 保存 / 删除                                                         */
/* ------------------------------------------------------------------ */

async function save() {
  if (state.busy || !state.draft) return;
  state.busy = true;
  const btn = $('.editor-head button.primary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中…';
  }

  try {
    const cfg = currentCfg();
    const r = await api('/api/save', {
      type: state.type,
      id: state.draft.id,
      isNew: state.draft.isNew,
      meta: state.draft.meta,
      body: state.draft.body,
      removeSample: state.draft.removeSample
    });

    state.dirty = false;
    toast('已保存 ' + r.file);
    r.warnings.forEach((w) => toast(w, false));

    await refreshAll(false);
    await openItem(r.id);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }
}

async function removeItem() {
  if (!state.draft || !state.draft.id) return;
  const cfg = currentCfg();
  const ok = window.confirm(
    '删除 ' + state.draft.id + '？\n文件会从 content/ 里删掉，本地 git 还留着历史，需要的话能找回来。'
  );
  if (!ok) return;

  try {
    await api('/api/delete', { type: state.type, id: state.draft.id });
    state.dirty = false;
    toast('已删除');
    await refreshAll(false);
    openFirst();
  } catch (err) {
    toast(err.message, true);
  }
}

async function refreshAndReopen() {
  const id = state.draft ? state.draft.id : null;
  state.dirty = false;
  await refreshAll(false);
  if (id) openItem(id);
  else openFirst();
}

/* ------------------------------------------------------------------ */
/* 发布                                                                */
/* ------------------------------------------------------------------ */

async function publish() {
  if (state.dirty) {
    const go = window.confirm('还有没保存的改动，先保存再发布？\n（点「取消」则直接发布已保存的内容）');
    if (go) {
      await save();
      if (state.dirty) return;
    }
  }

  const btn = $('#publish');
  btn.disabled = true;
  btn.textContent = '发布中…';

  const bar = $('#logbar');
  bar.hidden = false;
  $('#log').innerHTML = '';
  $('#log-title').textContent = '发布日志';
  state.logShown = 0;

  try {
    const r = await api('/api/publish', {});
    let job = null;
    for (;;) {
      job = await api('/api/job?id=' + encodeURIComponent(r.jobId));
      appendLog(job.lines);
      if (job.done) break;
      await sleep(700);
    }

    if (job.ok) {
      $('#log-title').textContent = '发布完成';
      toast(job.warning || '已发布，GitHub Pages 大约 1 分钟后更新');
      await refreshAll(false);
    } else {
      $('#log-title').textContent = '发布失败';
      toast(job.error || '发布失败，看下面的日志', true);
    }
  } catch (err) {
    $('#log-title').textContent = '发布失败';
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '发布到网站';
  }
}

function appendLog(lines) {
  const pre = $('#log');
  for (; state.logShown < lines.length; state.logShown++) {
    const line = lines[state.logShown];
    const span = el('span', {
      class: line.text.startsWith('✗') ? 'err' : line.text.startsWith('✓') ? 'ok' : line.text.startsWith('$') ? 'stage' : 'dim',
      text: line.text + '\n'
    });
    pre.appendChild(span);
  }
  pre.scrollTop = pre.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

boot();
