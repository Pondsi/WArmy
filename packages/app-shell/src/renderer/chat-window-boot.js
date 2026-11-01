/**
 * 独立会话窗的第一帧：在主界面 DOM 解析之前就把 body 标成 liaoTianChuangKou。
 *
 * 为什么必须在 <body> 开头同步执行：
 *   以前只在 app.js 末尾加 class。app.js 很大且要先等 boot 的异步数据，
 *   浏览器早已把「左栏 + 列表 + 空态」画出来 —— 用户看到的是完整主界面，
 *   过一会儿才变成聊天 + 第四列（看起来就是"开错了窗口"）。
 *   这里在解析任何界面节点之前先打标记，CSS 从第一帧起就只排版第三/第四列。
 *
 * 主窗口没有 mode=fu / chatId 时不加任何 class，行为完全不变。
 */
(function () {
  try {
    var q = new URLSearchParams(window.location.search || '');
    var shiDuLi = q.get('mode') === 'fu' || !!q.get('chatId');
    if (!shiDuLi) return;
    document.documentElement.classList.add('warmyChatWindow');
    if (document.body) document.body.classList.add('liaoTianChuangKou');
    document.documentElement.setAttribute('data-chat-window-boot', '1');
  } catch (_) { /* 参数解析失败就按主窗口走，绝不让窗口空白 */ }
})();
