/* ==================================================================
   自留地 · 评论区（Waline）
   ------------------------------------------------------------------
   做什么：
     把博客文章、每条近况下面的「留言」区块，接到你自己部署的 Waline 服务。
     访客只要填个昵称就能留言，不需要注册任何账号；留言存在你自己的数据库里。

   怎么工作：
     1. main.js 先把带 data-comment-term 的区块渲染出来（默认是收起的）
     2. 这个文件监听区块展开事件，第一次展开才去下载 Waline
        —— 打开博客页不会一次性下载 280KB 第三方脚本，也不会建三个实例
     3. 每个区块用 term 当评论的「钥匙」：文章用 post-001，近况用 update-001
        这样即使以后博客有了独立网址，已经存下的评论也不会认不出来

   配置在哪：content/site-config.js
   ================================================================== */

(function () {
  'use strict';

  var CONFIG = window.SITE_COMMENTS || {};

  /* Waline 客户端从 CDN 加载。版本写死在这里，将来升级只改这两行 */
  var CLIENT_JS = 'https://unpkg.com/@waline/client@v3/dist/waline.js';
  var CLIENT_CSS = 'https://unpkg.com/@waline/client@v3/dist/waline.css';

  /* 一页上可能有三个评论区，共用同一次下载：谁先展开谁触发，后面的人等同一个 Promise */
  var clientPromise = null;
  var cssInjected = false;

  /** serverURL 填了才算配置完成 */
  function isConfigured() {
    return Boolean(CONFIG.serverURL && String(CONFIG.serverURL).trim());
  }

  /** 末尾斜杠会让请求地址变成 //api/comment，先去掉 */
  function serverURL() {
    return String(CONFIG.serverURL).trim().replace(/\/+$/, '');
  }

  /** 一条提示框（内容都是我们自己写死的字，不涉及访客输入） */
  function makeNotice(html) {
    var box = document.createElement('div');
    box.className = 'comments-note';
    box.innerHTML = html;
    return box;
  }

  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CLIENT_CSS;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }

  /** 下载并返回 Waline 的 init 函数，只下载一次 */
  function loadClient() {
    if (clientPromise) return clientPromise;

    injectCss();

    /* 动态 import：比再插一个 <script> 干净，能拿到加载失败的错误 */
    clientPromise = import(CLIENT_JS).then(function (mod) {
      var init = mod && (mod.init || (mod.default && mod.default.init));
      if (typeof init !== 'function') {
        throw new Error('Waline 客户端结构异常');
      }
      return init;
    });

    return clientPromise;
  }

  /**
   * 在 host 里挂载一个评论区
   * @param {HTMLElement} host 承载评论区的容器
   * @param {string} term 评论归属标识，如 post-001
   */
  function mount(host, term) {
    if (!host || host.getAttribute('data-mounted') === '1') return;
    host.setAttribute('data-mounted', '1');

    if (!isConfigured()) {
      host.appendChild(
        makeNotice(
          '评论区还没启用。打开 <code>content/site-config.js</code>，' +
            '把 Waline 服务地址填进 <code>serverURL</code>，这里就会出现留言框。<br>' +
            '具体步骤见 README 第十节。'
        )
      );
      return;
    }

    var box = document.createElement('div');
    box.className = 'waline-box';
    host.appendChild(box);

    loadClient()
      .then(function (init) {
        init({
          el: box,
          serverURL: serverURL(),

          /* 用 term 当评论的键，和网址解绑 */
          path: term,

          lang: CONFIG.lang || 'zh-CN',

          /* 关键设置：不强制注册，填昵称就能留言 */
          login: 'disable',
          meta: ['nick', 'mail'],
          requiredMeta: ['nick'],

          /* 20 条一页，个人站的留言量级够用 */
          pageSize: 20,

          /* 只做留言，不做浏览量统计和站内搜索 */
          comment: true,
          pageview: false,
          search: false,
          reaction: false,

          /* 默认关掉图片上传：Waline 默认把图片转成 Base64 塞进数据库，
             几张手机照片就能把免费数据库额度撑满。要开就把 site-config.js
             里的 allowImageUpload 改成 true。 */
          imageUploader: CONFIG.allowImageUpload === true ? undefined : false,

          /* 表情默认关闭，省掉几十张图的请求；改成 true 则加载 Waline 内置表情 */
          emoji: CONFIG.emoji === true ? true : false,

          noRss: true,
          dark: false
        });
      })
      .catch(function (err) {
        /* 加载失败要能让页面继续用：清掉空容器，换成一句人话 */
        if (box.parentNode) box.parentNode.removeChild(box);

        var tip = location.protocol === 'file:'
          ? '现在是双击打开的本地文件，浏览器可能拦下了外部脚本。'
          : '可能是网络问题，或者服务地址填错了。';
        host.appendChild(makeNotice('评论组件没能加载出来。' + tip + '其它内容不受影响。'));

        if (window.console && console.warn) {
          console.warn('[comments] Waline 加载失败：', err);
        }
      });
  }

  /** 给所有带 data-comment-term 的折叠块绑定「第一次展开才加载」 */
  function bind() {
    var blocks = document.querySelectorAll('[data-comment-term]');

    /* 没配置服务地址时，整块「留言」直接不显示。
       上线后访客只该看到成品，不该看到「评论区还没启用，去改 site-config.js」
       这种开发期的提示；作者自己看控制台那一行就够了。 */
    if (!isConfigured()) {
      Array.prototype.forEach.call(blocks, function (block) {
        block.hidden = true;
      });
      if (blocks.length && window.console && console.info) {
        console.info(
          '[comments] 还没配置 Waline 服务地址，留言区已隐藏（见 content/site-config.js）'
        );
      }
      return;
    }

    Array.prototype.forEach.call(blocks, function (block) {
      if (block.getAttribute('data-bound') === '1') return;
      block.setAttribute('data-bound', '1');

      var host = block.querySelector('.comments-host');
      var term = block.getAttribute('data-comment-term');

      block.addEventListener('toggle', function () {
        if (block.open) mount(host, term);
      });

      /* 万一进来时已经是展开状态（比如浏览器记住了），也补一次 */
      if (block.open) mount(host, term);
    });
  }

  /* 暴露出去，方便以后手动触发（比如新增了页面） */
  window.Comments = { bind: bind, mount: mount };

  /* 必须等 main.js 把内容渲染完再绑，
     main.js 的 DOMContentLoaded 先注册，所以这里天然排在它后面。
     再包一层 setTimeout 是保险：万一执行顺序变了也不会失效。 */
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(bind, 0);
  });

  if (document.readyState !== 'loading') {
    setTimeout(bind, 0);
  }
})();
