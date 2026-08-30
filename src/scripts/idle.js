// ========== Idle 隐藏 UI：3 秒无操作自动淡出 ==========
    (function () {
      var IDLE_TIMEOUT = 3000;
      var idleTimer = null;
      var isIdle = false;

      function shouldBeIdle() {
        // 编辑/焦点模式：UI 已经被显式控制，不抢
        if (document.body.classList.contains('editing')) return false;
        if (document.body.classList.contains('focus-mode')) return false;
        // 输入框/文本域聚焦：用户在打字
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
        // 弹窗/AI 面板/速记本/右下角菜单/右键菜单打开：用户正在使用，鼠标不在主界面背景上
        if (document.querySelector('.modal-mask.open, .ai-panel.open, .note-panel.open, .menu-wrapper.open, .ctx-menu.open')) return false;
        return true;
      }

      function enterIdle() {
        if (!shouldBeIdle()) { scheduleIdle(); return; }
        document.body.classList.add('idle');
        isIdle = true;
      }

      function exitIdle() {
        if (!isIdle) return;
        document.body.classList.remove('idle');
        isIdle = false;
      }

      function scheduleIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(enterIdle, IDLE_TIMEOUT);
      }

      function onActivity() {
        exitIdle();
        scheduleIdle();
      }

      // 监听活动事件（passive 不阻塞默认行为，性能更好）
      ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(function (evt) {
        document.addEventListener(evt, onActivity, { passive: true });
      });

      // 启动 idle 计时
      scheduleIdle();

      // 调试钩子
      window.__debug.idle = { force: enterIdle, wake: exitIdle, shouldBeIdle: shouldBeIdle };
    })();
