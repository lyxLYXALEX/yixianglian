/* ==================================================================
   自留地 · 主脚本
   ------------------------------------------------------------------
   这个文件负责：把 content/data.js 里的内容
   渲染到页面上。所有函数都会先检查页面上有没有对应的容器，
   没有就直接跳过，所以同一个 main.js 可以被 5 个页面共用。

   结构：
   0. 小工具
   1. 页头时间 / 页脚信息
   2. 首页
   3. 博客
   4. 近况 + 灯箱
   5. 作品
   6. 关于
   ================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     0. 小工具
     ------------------------------------------------------------------ */

  /** 取单个元素 */
  function $(selector) {
    return document.querySelector(selector);
  }

  /** 把文本里的特殊字符转义，避免标题里的 < > & 破坏结构 */
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 没有内容时统一显示的提示 */
  function emptyHint(text) {
    return '<p class="empty">' + esc(text) + '</p>';
  }

  /** 状态文字 → 对应颜色标签的类名 */
  function statusClass(status) {
    if (status === '已完成') return 'status-done';
    if (status === '半成品' || status === '进行中') return 'status-doing';
    return 'status-dead';
  }

  /* ------------------------------------------------------------------
     1. 页头时间 / 页脚信息
     ------------------------------------------------------------------ */

  /** 页头右上角的小时钟，纯装饰 */
  function setupClock() {
    var el = $('#clock');
    if (!el) return;

    function tick() {
      var now = new Date();
      var parts = [now.getHours(), now.getMinutes(), now.getSeconds()].map(function (n) {
        return String(n).padStart(2, '0');
      });
      el.textContent = parts.join(':');
    }

    tick();
    setInterval(tick, 1000);
  }

  /** 页脚里的年份和「最后更新」 */
  function fillFootMeta() {
    var year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    var updated = $('#updated');
    if (updated && window.SITE_BUILD_DATE) {
      updated.textContent = window.SITE_BUILD_DATE;
    }
  }

  /* ------------------------------------------------------------------
     2. 首页
     ------------------------------------------------------------------ */

  /* 首页那句短话，点「换一句」会按顺序往下换。
     句子在 content/quotes.js（window.SITE_QUOTES）里，这里只负责画出来；
     那个文件没加载时退回下面几行，免得首屏空一块。 */
  var FALLBACK_LINES = [
    { text: '这里放三样东西：写下来的、拍下来的、做了一半的。', from: '' },
    { text: '没有更新计划，想到就写。', from: '' },
    { text: '一个抽屉。不对外开放，但你进来了。', from: '' },
    { text: '左边是生活，右边是没做完的实验。', from: '' },
    { text: '慢，但一直在。', from: '' }
  ];

  function setupLineSwitcher() {
    var btn = $('#shuffle-line');
    var out = $('#hero-lead');
    if (!btn || !out) return;

    var lines = window.SITE_QUOTES && window.SITE_QUOTES.length
      ? window.SITE_QUOTES
      : FALLBACK_LINES;

    /* 歌词和出处分两行：出处的字号更小、颜色更淡。
       用两个 span 而不是拼一行字符串，是为了能分别给样式。 */
    var textEl = document.createElement('span');
    textEl.className = 'hero-quote-text';
    var fromEl = document.createElement('span');
    fromEl.className = 'hero-quote-from';

    out.textContent = '';
    out.appendChild(textEl);
    out.appendChild(fromEl);

    var index = 0;

    function render() {
      var line = lines[index];
      textEl.textContent = line.text;
      /* 破折号跟着出处一起出现，没有出处时整行不显示 */
      fromEl.textContent = line.from ? '——' + line.from : '';
      fromEl.hidden = !line.from;
    }

    render();

    btn.addEventListener('click', function () {
      index = (index + 1) % lines.length;
      render();
    });
  }

  /* 跑马灯：鼠标停上去时速度慢下来。
     为什么不直接用 CSS 把 animation-duration 改长：
     动画已经在跑了，中途改 duration，浏览器会按「已播比例」重新算当前位置，画面会突然跳一下。
     改 playbackRate 只动倍速、不动时间轴，才能平滑地慢下去。
     再用 requestAnimationFrame 一帧帧逼近目标倍速，而不是瞬间切换 ——
     手感像松油门，而不是按了个开关。 */
  var MARQUEE_SLOW_RATE = 0.25; // 悬停时降到四分之一速

  function setupMarqueeSpeed() {
    var marquee = $('.marquee');
    var track = marquee ? $('.marquee-track') : null;
    if (!marquee || !track) return;

    // 用户要求减少动画时，CSS 里那圈动画根本没在播，也就没什么可减速的
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var current = 1;  // 当前倍速
    var target = 1;   // 目标倍速
    var frameId = 0;
    var anim = null;

    function getAnimation() {
      if (anim && anim.playState !== 'idle') return anim;
      var list = track.getAnimations ? track.getAnimations() : [];
      anim = null;
      for (var i = 0; i < list.length; i++) {
        // 只认 CSS 动画，别把 transition 当成跑马灯
        if (list[i].animationName) {
          anim = list[i];
          break;
        }
      }
      return anim;
    }

    function step() {
      var running = getAnimation();
      if (!running) {
        frameId = 0;
        return;
      }

      current += (target - current) * 0.14; // 每帧走剩余距离的 14%，约半秒过渡完
      if (Math.abs(target - current) < 0.004) {
        current = target;
        frameId = 0;
      } else {
        frameId = window.requestAnimationFrame(step);
      }
      running.playbackRate = current;
    }

    function to(rate) {
      target = rate;
      if (!frameId) frameId = window.requestAnimationFrame(step);
    }

    marquee.addEventListener('pointerenter', function (event) {
      // 手指按上去也会派发 pointerenter，但那不是「悬停」，别减速
      if (event.pointerType && event.pointerType !== 'mouse') return;
      to(MARQUEE_SLOW_RATE);
    });

    marquee.addEventListener('pointerleave', function () {
      to(1);
    });
  }

  /** 首页三个入口上的数量统计 */
  function renderHomeCounts() {
    var posts = window.SITE_POSTS || [];
    var works = window.SITE_WORKS || [];
    var updates = window.SITE_UPDATES || [];

    var map = {
      '#count-posts': posts.length + ' 篇',
      '#count-updates': updates.length + ' 条',
      '#count-works': works.length + ' 个'
    };

    Object.keys(map).forEach(function (selector) {
      var el = $(selector);
      if (el) el.textContent = map[selector];
    });
  }

  /** 首页的「最近写下的」三条 */
  function renderRecentPosts() {
    var list = $('#recent-list');
    if (!list) return;

    var posts = window.SITE_POSTS || [];
    if (posts.length === 0) {
      list.innerHTML = emptyHint('还没有文章。');
      return;
    }

    list.innerHTML = posts
      .slice(0, 3)
      .map(function (post) {
        return (
          '<li>' +
          '<span class="recent-date">' + esc(post.displayDate) + '</span>' +
          '<a class="recent-title" href="blog.html#' + esc(post.id) + '">' + esc(post.title) + '</a>' +
          '</li>'
        );
      })
      .join('');
  }

  /* ------------------------------------------------------------------
     3. 博客
     ------------------------------------------------------------------ */

  function renderBlog() {
    var list = $('#post-list');
    if (!list) return;

    var posts = window.SITE_POSTS || [];

    var total = $('#post-total');
    if (total) total.textContent = posts.length + ' 篇';

    if (posts.length === 0) {
      list.innerHTML = emptyHint('还没有文章。在 content/posts/ 里新建一个 .md 文件就可以开始写。');
      return;
    }

    list.innerHTML = posts
      .map(function (post) {
        return (
          '<details class="post-entry" id="' + esc(post.id) + '">' +
          '<summary>' +
          '<span class="post-date">' + esc(post.displayDate) + '</span>' +
          '<span class="post-title">' + esc(post.title) + '</span>' +
          '<span class="post-tag">' + esc(post.tag) + '</span>' +
          (post.sample ? '<span class="badge-sample">示例</span>' : '') +
          '<span class="post-mark" aria-hidden="true">+</span>' +
          '</summary>' +
          '<div class="post-body">' +
          (post.summary ? '<p class="post-summary-line">' + esc(post.summary) + '</p>' : '') +
          '<div class="prose">' + post.html + '</div>' +
          /* 评论区：默认收起，展开时才由 comments.js 加载 Waline */
          '<details class="post-comments" data-comment-term="' + esc(post.id) + '">' +
          '<summary><span>留言</span><span class="comments-mark" aria-hidden="true">+</span></summary>' +
          '<div class="comments-host"></div>' +
          '</details>' +
          '</div>' +
          '</details>'
        );
      })
      .join('');
  }

  /** 从别的页面带 hash 跳过来时（blog.html#post-002），自动展开那篇 */
  function openPostFromHash() {
    if (!location.hash) return;

    var target = document.getElementById(location.hash.slice(1));
    if (target && target.tagName === 'DETAILS') {
      target.open = true;
      target.scrollIntoView({ block: 'center' });
    }
  }

  /* ------------------------------------------------------------------
     4. 近况 + 灯箱
     ------------------------------------------------------------------ */

  /* 网格里一格大约这么宽（自动填充 220px 起，最多三列左右） */
  var DEFAULT_SIZES = '(max-width: 700px) 50vw, (max-width: 1200px) 33vw, 300px';

  /**
   * 生成一个可点开的图片方块（近况和作品共用）
   * @param {{src:string, caption:string}} photo
   * @param {string} altBase 没有图注时用的 alt 文案
   * @param {number} [viewWidth] 展示图的实际长边，用于 srcset 标注。
   *   近况档 1600、作品档 2400（见 tools/compress-photos.js 的两档参数），
   *   标错的话浏览器会估错带宽，可能放着大图不用。
   * @param {string} [sizes] 这张图占多宽。默认按 220px 小格子写，
   *   单张铺满整行的时候要传 100vw，否则浏览器会以为只有 300px 宽，
   *   放着 1600w 的展示图不用，结果拿 800w 的缩略图去铺满整行，会糊。
   */
  function photoFigure(photo, altBase, viewWidth, sizes) {
    var caption = photo.caption || '';
    var view = photo.src;
    var viewW = viewWidth || 1600;

    /* 双尺寸：网格里下缩略图，点开才下展示图。
       约定成 xxx-view.webp → xxx-thumb.webp，压缩脚本就是这么输出的；
       如果只有一张图（比如老的 .svg 占位图），就照旧用单图。 */
    var thumb = photo.thumb ||
      (/-view\.webp$/i.test(view) ? view.replace(/-view\.webp$/i, '-thumb.webp') : '');

    var imgAttrs = ' src="' + esc(thumb || view) + '"';
    if (thumb) {
      imgAttrs +=
        ' srcset="' + esc(thumb) + ' 800w, ' + esc(view) + ' ' + viewW + 'w"' +
        ' sizes="' + esc(sizes || DEFAULT_SIZES) + '"';
    }

    return (
      '<figure class="photo">' +
      '<button type="button" class="photo-btn" data-src="' + esc(view) + '"' +
      ' data-caption="' + esc(caption) + '"' +
      ' aria-label="放大查看：' + esc(caption || altBase) + '">' +
      '<img' + imgAttrs + ' alt="' + esc(caption || altBase) + '"' +
      ' loading="lazy" decoding="async">' +
      '</button>' +
      (caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') +
      '</figure>'
    );
  }

  /** 一组图片。只有一张时不套网格，直接铺满一行 */
  function photoGroup(photos, altBase, viewWidth) {
    var list = photos || [];
    if (list.length === 0) return '';

    var gridClass =
      list.length === 1 ? 'photo-grid photo-grid-single' :
      list.length === 2 ? 'photo-grid photo-grid-2' :
      'photo-grid';

    /* 一张：铺满整行（高度上限在 CSS 18 节）；两张：对半分；
       三张以上才是 220px 起的小格子 */
    var sizes =
      list.length === 1 ? '100vw' :
      list.length === 2 ? '(max-width: 700px) 100vw, 50vw' :
      DEFAULT_SIZES;

    return (
      '<div class="' + gridClass + '">' +
      list.map(function (photo) {
        return photoFigure(photo, altBase, viewWidth, sizes);
      }).join('') +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
     3.5 公告存档（只在近况页有容器时渲染）

     公告关掉就没了，这在「通知」的层面是对的，但作者需要能回看历史。
     所以近况页顶部留一个折叠区，把所有公告按时间列出来。
     弹窗逻辑在 announcement.js，两个文件互不依赖。
     ------------------------------------------------------------------ */

  function renderNoticeArchive() {
    var root = $('#notice-archive');
    if (!root) return;

    var notices = window.SITE_NOTICES || [];
    if (!notices.length) return;

    var items = notices
      .map(function (item) {
        return (
          '<article class="notice-item' + (item.active ? ' is-active' : '') + '">' +
          '<header class="notice-item-head">' +
          '<span class="notice-item-date">' + esc(item.displayDate) + '</span>' +
          (item.active ? '<span class="notice-item-flag">当前</span>' : '') +
          (item.sample ? '<span class="badge-sample">示例</span>' : '') +
          '</header>' +
          '<h2 class="notice-item-title">' + esc(item.title) + '</h2>' +
          '<div class="notice-item-body prose">' + item.html + '</div>' +
          '</article>'
        );
      })
      .join('');

    /* 默认收起：它是存档，不是正文，不该占掉近况首页的位置 */
    root.innerHTML =
      '<details class="notice-archive">' +
      '<summary>' +
      '<span class="notice-archive-label">站点公告</span>' +
      '<span class="notice-archive-count">' + notices.length + ' 条</span>' +
      '<span class="comments-mark" aria-hidden="true">+</span>' +
      '</summary>' +
      '<div class="notice-archive-body">' + items + '</div>' +
      '</details>';

    /* 从公告弹窗里的「看全部」跳过来时，自动展开。
       否则浏览器滚到位置了，盒子却合着，看起来像没跳成功。 */
    if (window.location.hash === '#notice-archive') {
      var box = root.querySelector('.notice-archive');
      if (box) box.open = true;
    }
  }

  function renderUpdates() {
    var root = $('#update-list');
    if (!root) return;

    var updates = window.SITE_UPDATES || [];

    var total = $('#update-total');
    if (total) total.textContent = updates.length + ' 条';

    if (updates.length === 0) {
      root.innerHTML = emptyHint(
        '还没有近况。在 content/updates/ 里新建一个 .md 文件，写一句或放几张照片。'
      );
      return;
    }

    root.innerHTML = updates
      .map(function (item) {
        var head =
          '<header class="update-head">' +
          '<span class="update-date">' + esc(item.displayDate) + '</span>' +
          (item.place ? '<span class="update-place">' + esc(item.place) + '</span>' : '') +
          (item.sample ? '<span class="badge-sample">示例</span>' : '') +
          '</header>';

        var text = item.html ? '<div class="update-text prose">' + item.html + '</div>' : '';

        /* 图片挂上评论用的 term，跟文字同样按条目 id 区分 */
        var photos = item.photos && item.photos.length
          ? photoGroup(item.photos, item.displayDate + ' 的照片')
          : '';

        return (
          '<article class="update" id="' + esc(item.id) + '">' +
          head +
          text +
          photos +
          '<details class="update-comments" data-comment-term="' + esc(item.id) + '">' +
          '<summary><span>留言</span><span class="comments-mark" aria-hidden="true">+</span></summary>' +
          '<div class="comments-host"></div>' +
          '</details>' +
          '</article>'
        );
      })
      .join('');
  }

  function setupLightbox() {
    var box = $('#lightbox');
    if (!box) return;

    var image = $('#lightbox-img');
    var caption = $('#lightbox-cap');
    var closeBtn = $('.lightbox-close');

    function open(src, text) {
      image.src = src;
      image.alt = text || '照片大图';
      caption.textContent = text || '';
      /* 已经是打开状态就别再 showModal，那会报 InvalidStateError */
      if (!box.open) box.showModal();
      document.body.classList.add('no-scroll');
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      if (box.open) box.close();
    }

    /* 关闭后的收尾统一放这儿：Esc、点遮罩、点按钮都是走 close() */
    box.addEventListener('close', function () {
      image.removeAttribute('src');
      document.body.classList.remove('no-scroll');
    });

    /* 用事件委托，图片是后渲染出来的也能响应 */
    document.addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('.photo-btn');
      if (btn) {
        open(btn.dataset.src, btn.dataset.caption);
        return;
      }
      /* 点黑色背景才关闭，点图片本身不关 */
      if (event.target === box) close();
    });

    if (closeBtn) closeBtn.addEventListener('click', close);

    /* Esc 交给 <dialog> 自己处理，不用再挂 keydown */
  }

  /* ------------------------------------------------------------------
     5. 作品
     ------------------------------------------------------------------ */

  /* 作品档的展示图是 2400px 长边（见 tools/compress-photos.js），
     srcset 里如实标注，浏览器才会在该取大图时取大图。 */
  var WORK_VIEW_WIDTH = 2400;

  function renderWorks() {
    var list = $('#work-list');
    if (!list) return;

    var works = window.SITE_WORKS || [];

    var total = $('#work-total');
    if (total) total.textContent = works.length + ' 个';

    if (works.length === 0) {
      list.innerHTML = emptyHint('还没有作品。做完一个东西就记一笔，半成品也算。');
      return;
    }

    list.innerHTML = works
      .map(function (work) {
        /* 封面：有就显示在最上面，点开能看大图。
           封面铺满卡片宽度，卡片在 300px 起自动排，宽屏大约三列 */
        var cover = work.cover
          ? '<div class="work-cover">' + photoFigure(
              { src: work.cover, caption: '' },
              work.title,
              WORK_VIEW_WIDTH,
              '(max-width: 760px) 100vw, (max-width: 1200px) 50vw, 360px'
            ) + '</div>'
          : '';

        /* 有正文或有组图，才给「展开看看」。
           点了是弹窗（见 setupWorkModal），不在卡片里往下撑。 */
        var hasMore = (work.html && work.html.trim()) || (work.photos && work.photos.length);
        var more = hasMore
          ? '<button class="work-open" type="button" data-work="' + esc(work.id) + '">' +
            '展开看看<span class="work-open-mark" aria-hidden="true">+</span>' +
            '</button>'
          : '';

        return (
          '<article class="work-card">' +
          cover +
          '<div class="work-top">' +
          '<span class="work-year">' + esc(work.year) + '</span>' +
          (work.sample ? '<span class="badge-sample">示例</span>' : '') +
          '<span class="status ' + statusClass(work.status) + '">' + esc(work.status) + '</span>' +
          '</div>' +
          '<h3 class="work-title">' + esc(work.title) + '</h3>' +
          (work.summary ? '<p class="work-summary">' + esc(work.summary) + '</p>' : '') +
          more +
          (work.link ? '<a class="work-link" href="' + esc(work.link) + '">去看看 →</a>' : '') +
          '</article>'
        );
      })
      .join('');
  }

  /* 作品详情弹窗：点「展开看看」弹出一个框，把正文和组图装进去。
     为什么不做原地展开：一组四五张图会把卡片撑得很长，看完还得自己
     滑回原来的位置；弹窗关掉，页面停在哪儿还是哪儿。
     结构由 JS 建，和公告弹窗同一套做法，5 个页面都不用改 HTML。 */
  function setupWorkModal() {
    var works = window.SITE_WORKS || [];
    if (!works.length) return;

    /* id → 作品。按钮上只带 id，正文 HTML 不进属性，
       否则几十 KB 的 HTML 会被转义进 data-* 里，又长又难读。 */
    var index = {};
    works.forEach(function (work) {
      index[work.id] = work;
    });

    var modal = document.createElement('dialog');
    modal.className = 'work-modal';
    modal.setAttribute('aria-labelledby', 'work-modal-title');
    modal.innerHTML =
      '<div class="work-modal-box">' +
        '<div class="work-modal-bar">' +
          '<span class="work-modal-tag">作品</span>' +
          '<span class="work-modal-year"></span>' +
          '<span class="status work-modal-status"></span>' +
          '<button class="work-modal-x" type="button" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="work-modal-body">' +
          '<h2 class="work-modal-title" id="work-modal-title"></h2>' +
          '<p class="work-modal-summary"></p>' +
          '<div class="work-modal-prose prose"></div>' +
          '<div class="work-modal-photos"></div>' +
        '</div>' +
        '<div class="work-modal-foot">' +
          '<button class="btn work-modal-ok" type="button">合上</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var yearEl = modal.querySelector('.work-modal-year');
    var statusEl = modal.querySelector('.work-modal-status');
    var titleEl = modal.querySelector('.work-modal-title');
    var summaryEl = modal.querySelector('.work-modal-summary');
    var proseEl = modal.querySelector('.work-modal-prose');
    var photosEl = modal.querySelector('.work-modal-photos');

    function open(id) {
      var work = index[id];
      if (!work) return;

      yearEl.textContent = work.year || '';
      statusEl.textContent = work.status || '';
      statusEl.className = 'status ' + statusClass(work.status);
      titleEl.textContent = work.title;
      summaryEl.textContent = work.summary || '';
      summaryEl.hidden = !work.summary;
      proseEl.innerHTML = work.html || '';
      proseEl.hidden = !(work.html && work.html.trim());

      /* 弹窗里的图 = 封面 + 组图。
         封面在卡片上已经露过一次，但展开之后也该看得见它，
         所以放到网格第一格；万一站长在 photos 里又写了一遍同一张，跳过别重复。 */
      var gallery = [];
      if (work.cover) gallery.push({ src: work.cover, caption: '封面' });
      (work.photos || []).forEach(function (photo) {
        if (photo.src !== work.cover) gallery.push(photo);
      });

      photosEl.innerHTML = gallery.length
        ? photoGroup(gallery, work.title, WORK_VIEW_WIDTH)
        : '';
      photosEl.hidden = !gallery.length;

      modal.showModal();
      document.documentElement.classList.add('is-dialog-open');
    }

    function close() {
      if (modal.open) modal.close();
    }

    /* 关掉就把正文和图片清掉：一个已经看不见的弹窗，
       没必要继续占着几张大图解码后的内存 */
    modal.addEventListener('close', function () {
      document.documentElement.classList.remove('is-dialog-open');
      proseEl.innerHTML = '';
      photosEl.innerHTML = '';
    });

    /* 事件委托：按钮是渲染出来的，弹窗是后建的，都能响应 */
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('.work-open');
      if (trigger) {
        open(trigger.dataset.work);
        return;
      }
      /* 点到遮罩（也就是 dialog 自己）才关，点面板里面不关 */
      if (event.target === modal) close();
    });

    modal.querySelector('.work-modal-x').addEventListener('click', close);
    modal.querySelector('.work-modal-ok').addEventListener('click', close);

    /* Esc 不用手写：<dialog> 自己处理，关掉时会派发 close 事件 */
  }

  /* ------------------------------------------------------------------
     6. 关于
     ------------------------------------------------------------------ */

  function renderAbout() {
    var body = $('#about-body');
    if (!body) return;

    var about = window.SITE_ABOUT;
    if (!about) {
      body.innerHTML = emptyHint('没有找到 content/about.md，运行一次 node tools/build-content.js 试试。');
      return;
    }

    var title = $('#about-title');
    if (title) title.textContent = about.title;

    var sample = $('#about-sample');
    if (sample && about.sample) sample.hidden = false;

    var photo = $('#about-photo');
    if (photo) {
      if (about.photo) {
        photo.src = about.photo;
        photo.alt = '站长的头像';
      } else {
        photo.parentElement.hidden = true;
      }
    }

    body.innerHTML = about.html;
  }

  /* ------------------------------------------------------------------
     启动
     ------------------------------------------------------------------ */

  function init() {
    setupClock();
    fillFootMeta();

    renderHomeCounts();
    renderRecentPosts();
    setupLineSwitcher();
    setupMarqueeSpeed();

    renderBlog();
    openPostFromHash();

    renderNoticeArchive();
    renderUpdates();
    setupLightbox();

    renderWorks();
    setupWorkModal();
    renderAbout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
