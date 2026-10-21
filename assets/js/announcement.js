/**
 * 全站公告弹窗
 * ------------------------------------------------------------------
 * 内容从哪来：
 *   content/announcements/*.md（一条公告一个文件，标了 active: true 的那条会弹）
 *     → node tools/build-content.js
 *     → window.SITE_ANNOUNCEMENT（在 content/data.js 里）
 *   所以改公告只改 md，不要来这里改文字。
 *
 * 什么时候弹：
 *   - 打开任意页面时自动弹（延迟一点点，先让页面画出来）
 *   - 同一则公告**每个访客只弹一次**，关掉后记在浏览器本地存储里
 *   - 如果访客是带着 #锚点 点进来的（比如某篇文章的分享链接），不弹，
 *     免得盖住他正要看的内容
 *   - 浏览器存不住「已读」时（无痕模式、直接双击本地 html 文件）不自动弹，
 *     只留页脚的「公告」按钮 —— 详见下面 pickStorage 那段说明
 *
 * 历史公告去哪看：
 *   近况页顶部的「站点公告」存档（由 main.js 的 renderNoticeArchive 渲染），
 *   这一条之外还有别的公告时，弹窗底部会出现「看全部 N 条公告」的入口。
 *
 * 不想要弹窗：
 *   把那条 md 的 active 改成 false，重新构建一次即可 —— 它仍然留在存档里。
 *
 * 用原生 <dialog>：
 *   自带焦点限制、Esc 关闭、遮罩层，比手写遮罩层可靠得多，也不用引库。
 */
(function () {
  'use strict';

  /* 本地存储的键名。存的是「最近一次关掉的公告 id」 */
  var STORAGE_KEY = 'ziliudi.notice.closed';

  /* 「最近一次自动弹出来」的时间戳。
     用来兜住另一种情况：访客看到公告后没点关闭，
     而是直接刷新、或者开个新标签页去看别的页面。
     这时没有「已读」记录，如果只认关闭记录，他会每翻一页被弹一次。
     所以额外记一个时间：这段时间内不再自动弹。 */
  var SHOWN_AT_KEY = 'ziliudi.notice.shownAt';

  /* 多久之内只自动弹一次。12 小时 ≈ 一个访客当天最多被打扰一次 */
  var REPEAT_GAP = 12 * 60 * 60 * 1000;

  /* 延迟多少毫秒再弹。给人一点时间看到页面，弹窗才不至于像报错 */
  var OPEN_DELAY = 600;

  /** 极简转义，用于标题、日期这类纯文本字段 */
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* -------- 本地存储：先探一下到底能不能写 --------
     背景：localStorage 并不总是可用。无痕模式、浏览器禁止站点数据、
     以及直接用 file:// 双击打开本地页面时，经常「读得到、写不进去」，
     而且 setItem 会静默失败、不报错。

     分三档，任何一档都要保证「能弹出来」，同时尽量别重复弹：
       能写 localStorage → 记在 localStorage（永久 + 12 小时窗口）
       只能写 sessionStorage → 记在 sessionStorage
       都写不了 → 退回 window.name（见下）

     window.name 是个老办法但正好合适：它挂在标签页上，
     同一个标签页里从一个页面跳到另一个页面不会清空，
     关掉标签就没了 —— 等于「这一趟逛站」的天然计数器。
     file:// 下 localStorage 用不了，它照样能用。 */

  /* window.name 里我们自己的字段名，前缀够长，不会撞到别的库 */
  var WINDOW_KEY = 'ziliudiNotice';

  function readWindowMark() {
    try {
      var raw = window.name;
      if (!raw || raw.charAt(0) !== '{') return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeWindowMark(id, at) {
    try {
      var data = readWindowMark() || {};
      data[WINDOW_KEY] = String(id);
      if (at) data[WINDOW_KEY + 'At'] = at;
      window.name = JSON.stringify(data);
    } catch (err) {
      /* 连这个都写不了，那就只能每页弹了，没有更好的办法 */
    }
  }

  function canWrite(storage) {
    try {
      var probe = 'ziliudi.probe';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  function pickStorage() {
    try {
      if (window.localStorage && canWrite(window.localStorage)) return window.localStorage;
    } catch (err) {
      /* 有的浏览器连访问 localStorage 这个属性都会抛错 */
    }

    try {
      if (window.sessionStorage && canWrite(window.sessionStorage)) return window.sessionStorage;
    } catch (err) {
      /* 同上 */
    }

    return null;
  }

  /* -------- 画面 -------- */

  function createDialog(data, canRemember) {
    var dialog = document.createElement('dialog');
    dialog.className = 'notice';
    dialog.setAttribute('aria-labelledby', 'notice-title');

    /* tone: alert 时顶栏换成橘红色，用来提醒「这条要认真看」 */
    var boxClass = 'notice-box' + (data.tone === 'alert' ? ' notice-alert' : '');

    /* 有历史公告时，弹窗底部留一个入口。关掉就再也找不到的话，
       等于把内容丢了 —— 页脚按钮只找得回「当前」这一条。 */
    var total = (window.SITE_NOTICES || []).length;
    var moreLink =
      total > 1
        ? '<a class="notice-more" href="updates.html#notice-archive">看全部 ' + total + ' 条公告 →</a>'
        : '';

    /* data.html 来自你自己写的 Markdown，构建时就转好了，这里可以直接插入。
       注意：这跟「评论内容」不是一回事 —— 评论是别人写的字，绝对不能用这种方式插。 */
    dialog.innerHTML =
      '<div class="' + boxClass + '">' +
        '<div class="notice-bar">' +
          '<span class="notice-tag">公告</span>' +
          (data.sample ? '<span class="notice-sample">示例</span>' : '') +
          '<span class="notice-date">' + escapeHtml(data.displayDate) + '</span>' +
          '<button type="button" class="notice-x" aria-label="关闭公告">×</button>' +
        '</div>' +
        '<h2 class="notice-title" id="notice-title">' + escapeHtml(data.title) + '</h2>' +
        '<div class="notice-body prose">' + data.html + '</div>' +
        '<div class="notice-foot">' +
          '<button type="button" class="btn notice-ok">知道了</button>' +
          moreLink +
          '<p class="notice-hint">' +
            (canRemember
              ? '关掉后不会再弹这一条。想再看，页脚有「公告」。'
              : '这台浏览器记不住「已读过」：关掉后这一趟不会再弹，下次打开可能还会看到。页脚有「公告」，随时能点。') +
          '</p>' +
        '</div>' +
      '</div>';

    return dialog;
  }

  /** 打开。已经开着、或者浏览器太老不支持 showModal，都直接不管 */
  function openDialog(dialog) {
    if (dialog.open) return true;
    if (typeof dialog.showModal !== 'function') return false;

    dialog.showModal();
    // 弹窗打开时锁住背景滚动，否则手机上能在弹窗后面滑动页面
    document.documentElement.classList.add('is-dialog-open');
    return true;
  }

  /** 页脚加一个「公告」按钮，关掉之后还能再看 */
  function addFooterButton(dialog) {
    var meta = document.querySelector('.site-foot .foot-meta');
    if (!meta) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'foot-notice';
    button.textContent = '公告';
    button.addEventListener('click', function () {
      openDialog(dialog);
    });

    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(button);
  }

  /* -------- 启动 -------- */

  function init() {
    var data = window.SITE_ANNOUNCEMENT;

    // 没有标 active 的公告、或者正文是空的，就什么都不做（页脚按钮也不加）
    if (!data || !data.active || !data.html) return;

    var store = pickStorage();

    var dialog = createDialog(data, !!store);
    document.body.appendChild(dialog);
    addFooterButton(dialog);

    function rememberClosed() {
      try {
        if (store) store.setItem(STORAGE_KEY, String(data.id));
      } catch (err) {
        /* 探过能写还写失败，那也没办法，下面 window.name 还有一份 */
      }
      writeWindowMark(data.id, Date.now());
    }

    function recallClosed() {
      try {
        if (store) {
          var saved = store.getItem(STORAGE_KEY);
          if (saved) return saved;
        }
      } catch (err) {
        /* 落到 window.name */
      }

      var mark = readWindowMark();
      return mark ? String(mark[WINDOW_KEY] || '') : '';
    }

    /* 刚刚是不是已经自动弹过一回了 */
    function shownRecently() {
      try {
        if (store) {
          var at = Number(store.getItem(SHOWN_AT_KEY) || 0);
          if (at > 0 && Date.now() - at < REPEAT_GAP) return true;
        }
      } catch (err) {
        /* 落到 window.name */
      }

      /* 同一个标签页里已经弹过：不再弹。
         这里不判 12 小时 —— 关掉标签页这个标记就没了，本来就是「这一趟」的语义。 */
      var mark = readWindowMark();
      return !!(mark && mark[WINDOW_KEY + 'At']);
    }

    function markShown() {
      var now = Date.now();
      try {
        if (store) store.setItem(SHOWN_AT_KEY, String(now));
      } catch (err) {
        /* 记不上就靠 window.name */
      }
      writeWindowMark(data.id, now);
    }

    // 关闭的统一出口：Esc、点遮罩、点 ×、点「知道了」最后都会走到 close 事件
    dialog.addEventListener('close', function () {
      document.documentElement.classList.remove('is-dialog-open');
      rememberClosed();
    });

    dialog.addEventListener('click', function (event) {
      // 两个关闭按钮
      var hit = event.target.closest && event.target.closest('.notice-x, .notice-ok');
      if (hit) {
        /* 先记账，再关。
           close 事件是异步派发的，万一访客点完立刻点链接跳去别的页面，
           那一拍可能赶不上，等于白记 —— 下次进站又弹。 */
        rememberClosed();
        dialog.close();
        return;
      }

      // 点到 .notice-box 之外的透明区域 = 点到了遮罩
      if (event.target === dialog) {
        rememberClosed();
        dialog.close();
      }
    });

    /* 注意这里**没有**「存不住就不弹」的分支：
       没有存储的环境（file:// 双击打开）靠 window.name 兜底，
       该弹还是要弹，只是「同一趟逛站只弹一次」的范围缩到当前标签页。 */

    // 已经关过这一条，就不再自动弹
    if (recallClosed() === String(data.id)) return;

    // 刚弹过一回了（比如访客没关就刷新、或者用新标签页翻页），别再糊一次
    if (shownRecently()) return;

    // 带锚点进来的（分享链接），别拿弹窗挡住正文
    if (window.location.hash && window.location.hash.length > 1) return;

    var reduceMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.setTimeout(function () {
      /* 真的弹出来了才记时间：浏览器不支持 dialog 时不该算「已打扰过」 */
      if (openDialog(dialog)) markShown();
    }, reduceMotion ? 0 : OPEN_DELAY);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
