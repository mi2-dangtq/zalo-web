// Injected by MainActivity.injectAll() after every page load and settings change.
// window.__zwConfig = { viewport: <px, 0 = auto>, css: <base css>, mobileCss: <zalo-mobile css or ''>,
//                       customCss: <user css> }
(function () {
  'use strict';
  var cfg = window.__zwConfig || {};
  var head = document.head || document.documentElement;
  var bridge = window.AndroidBridge;

  // ---------------------------------------------------------------- Styles

  function setStyle(id, css) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
    }
    if (el.textContent !== css) el.textContent = css;
    // Re-append so our rules stay after any styles Zalo added since the last run.
    head.appendChild(el);
  }

  setStyle('zw-base', cfg.css || '');
  setStyle('zw-mobile', cfg.mobileCss || '');
  setStyle('zw-custom', cfg.customCss || '');

  // ---------------------------------------------------------------- Viewport

  // Auto (0) keeps Zalo's own "width=device-width" meta; a fixed width overrides it.
  // The original content is remembered in data-zw-orig so switching back to Auto restores it.
  var width = parseInt(cfg.viewport, 10) || 0;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta && !meta.hasAttribute('data-zw-orig')) {
    meta.setAttribute('data-zw-orig', meta.getAttribute('content') || '');
  }
  if (width > 0) {
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.setAttribute('data-zw-orig', '');
      head.appendChild(meta);
    }
    var content = 'width=' + width + ', user-scalable=yes';
    if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
  } else if (meta) {
    var original = meta.getAttribute('data-zw-orig');
    if (original) {
      if (meta.getAttribute('content') !== original) meta.setAttribute('content', original);
    } else {
      meta.parentNode.removeChild(meta);
    }
  }

  // ---------------------------------------------------------------- Phone skin (zalo-mobile.css)

  // The skin collapses the composer toolbar; this adds the "⋯" button that brings it back.
  var root = document.documentElement;
  root.classList.toggle('zw-skin', !!cfg.mobileCss);
  if (!cfg.mobileCss) root.classList.remove('zw-tools-open');

  window.__zwEnsureToolsToggle = function () {
    var existing = document.querySelector('.zw-tools-toggle');
    if (!root.classList.contains('zw-skin')) {
      if (existing) existing.remove();
      return;
    }
    var bar = document.getElementById('chat-box-bar-id');
    if (!bar || (existing && bar.contains(existing))) return;
    var btn = document.createElement('div');
    btn.className = 'zw-tools-toggle';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Công cụ');
    btn.textContent = '⋯';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      root.classList.toggle('zw-tools-open');
    });
    bar.insertBefore(btn, bar.firstChild);
  };
  window.__zwEnsureToolsToggle();

  // Bottom tab bar. Zalo folds tabs into "•••" when its rail is short, so the skin hides the rail
  // at its natural size and this bar mirrors it: icon + unread badge copied from each real tab,
  // and a tap clicks the real tab. Left out: "Zalo Cloud" (a zCloud upsell) and "Công cụ"
  // (#mainTabToolBA, the zBusiness tools panel).
  function railTabs(rail) {
    return Array.prototype.filter.call(rail.querySelectorAll('.leftbar-tab'), function (t) {
      var title = t.getAttribute('title');
      return !!title && title !== 'Zalo Cloud' && t.id !== 'mainTabToolBA';
    });
  }

  window.__zwRenderTabBar = function () {
    var bar = document.getElementById('zw-tabbar');
    var rail = document.getElementById('main-tab');
    if (!root.classList.contains('zw-skin') || !rail || !rail.closest('#sidebarNav.compact-mode')) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div'); // not <nav>: Zalo styles nav elements
      bar.id = 'zw-tabbar';
      bar.addEventListener('click', function (ev) {
        var item = ev.target.closest('.zw-tab');
        var r = document.getElementById('main-tab');
        if (!item || !r) return;
        var tab = railTabs(r).filter(function (t) { return t.getAttribute('title') === item.dataset.title; })[0];
        if (!tab) return;
        // "Tài liệu" opens the My Documents chat: slide the placeholder in first, as for a tap on a
        // chat-list row (see "Instant chat opening" below).
        if (item.dataset.title === 'My Documents' && !document.querySelector('.conv-back-btn')) {
          window.__zwOpenBehindPlaceholder('My Documents', function () { tab.click(); });
          return;
        }
        tab.click();
      });
      document.body.appendChild(bar);
    }
    var tabs = railTabs(rail);
    var signature = tabs.map(function (t) {
      var icon = t.querySelector('.mmi-icon-wr');
      return t.getAttribute('title') + '|' + t.classList.contains('selected') + '|' + (icon ? icon.innerHTML : '');
    }).join('\u0001');
    if (bar.__zwSignature === signature) return;
    bar.__zwSignature = signature;
    bar.textContent = '';
    tabs.forEach(function (t) {
      var title = t.getAttribute('title');
      var item = document.createElement('div');
      item.className = 'zw-tab' + (t.classList.contains('selected') ? ' zw-tab--selected' : '');
      item.setAttribute('role', 'button');
      item.dataset.title = title;
      var icon = t.querySelector('.mmi-icon-wr');
      if (icon) item.appendChild(icon.cloneNode(true));
      var label = document.createElement('span');
      label.className = 'zw-tab__label';
      label.textContent = title === 'My Documents' ? 'Tài liệu' : title;
      item.appendChild(label);
      bar.appendChild(item);
    });
  };
  window.__zwRenderTabBar();

  // Instant chat opening. Zalo runs 0.2-0.9 s of its own JS before a tapped chat shows up, and
  // nothing on screen moves while it does. With the skin on, a tap on a conversation (or on the
  // "Tài liệu" tab) is held back for one painted frame so the placeholder (blue header with the
  // chat's name) is already sliding in; the slide then runs on the compositor and stays smooth
  // while Zalo works. The tap is then replayed to Zalo. The placeholder fades out once the slide is over and Zalo's chat view is
  // mounted, or after OPENING_MAX_MS if the tap didn't open anything.
  var OPENING_MAX_MS = 2500;
  var OPENING_SLIDE_MS = 160; // zw-slide-in in zalo-mobile.css

  window.__zwHideOpening = function () {
    var el = document.getElementById('zw-opening');
    if (!el || el.classList.contains('zw-opening--done')) return;
    el.classList.add('zw-opening--done');
    setTimeout(function () { el.remove(); }, 150);
  };

  // Back while the tap is still held back: drop it, so the chat doesn't open after all.
  window.__zwCancelOpening = function () {
    var el = document.getElementById('zw-opening');
    if (el) el.__zwCancelled = true;
    window.__zwHideOpening();
  };

  window.__zwSyncOpening = function () {
    var el = document.getElementById('zw-opening');
    if (!el) return;
    var age = Date.now() - el.__zwShownAt;
    if ((age >= OPENING_SLIDE_MS && document.querySelector('#chatViewContainer #header')) ||
        age > OPENING_MAX_MS) {
      window.__zwHideOpening();
    }
  };

  // Mirrors Zalo's chat header (back icon, title, empty subtitle line) so the swap is seamless.
  // The outer element fades out; the inner page slides in, so a fade can start mid-slide.
  function showOpening(title) {
    var old = document.getElementById('zw-opening');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'zw-opening';
    el.__zwShownAt = Date.now();
    var page = document.createElement('div');
    page.className = 'zw-opening__page';
    var header = document.createElement('div');
    header.className = 'zw-opening__header';
    var back = document.createElement('i');
    back.className = 'fa fa-icon-solid-left zw-opening__back';
    header.appendChild(back);
    var titles = document.createElement('div');
    titles.className = 'zw-opening__titles';
    var name = document.createElement('div');
    name.className = 'zw-opening__name';
    name.textContent = title;
    titles.appendChild(name);
    var sub = document.createElement('div');
    sub.className = 'zw-opening__sub';
    titles.appendChild(sub);
    header.appendChild(titles);
    page.appendChild(header);
    var body = document.createElement('div');
    body.className = 'zw-opening__body';
    page.appendChild(body);
    var composer = document.createElement('div');
    composer.className = 'zw-opening__composer';
    page.appendChild(composer);
    el.appendChild(page);
    document.body.appendChild(el);
    // Check every frame until Zalo's chat view is up (or the timeout passes).
    (function poll() {
      if (!document.getElementById('zw-opening')) return;
      window.__zwSyncOpening();
      requestAnimationFrame(poll);
    })();
    return el;
  }

  // Shows the placeholder and runs open() once the frame with it has been committed (the second
  // frame callback), unless Back cancelled the opening meanwhile.
  window.__zwOpenBehindPlaceholder = function (title, open) {
    var el = showOpening(title);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (el.__zwCancelled) {
          window.__zwHideOpening();
          return;
        }
        open();
      });
    });
  };

  // On window, capture phase: runs before Zalo's own click handlers. Replaced on every injection.
  if (window.__zwOpeningClick) window.removeEventListener('click', window.__zwOpeningClick, true);
  window.__zwOpeningClick = function (ev) {
    if (ev.__zwReplay) return;
    // Only in the single-pane layout: at 1000/1200px the chat opens beside the list.
    if (!root.classList.contains('zw-skin') || !document.querySelector('#sidebarNav.compact-mode') ||
        document.querySelector('.conv-back-btn')) return;
    var target = ev.target;
    if (!target || !target.closest) return;
    var item = target.closest('#conversationListId .conv-item');
    // The row's own "…" button opens a menu, not the chat.
    if (!item || target.closest('.z--btn--v2')) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    var title = item.querySelector('.conv-item-title__name');
    var init = {
      bubbles: true, cancelable: true, composed: true, view: window, detail: ev.detail,
      screenX: ev.screenX, screenY: ev.screenY, clientX: ev.clientX, clientY: ev.clientY,
      button: ev.button, buttons: ev.buttons
    };
    window.__zwOpenBehindPlaceholder(title ? title.textContent.trim() : '', function () {
      if (!target.isConnected) {
        window.__zwHideOpening();
        return;
      }
      var replay = new MouseEvent('click', init);
      replay.__zwReplay = true;
      target.dispatchEvent(replay);
    });
  };
  window.addEventListener('click', window.__zwOpeningClick, true);

  // ---------------------------------------------------------------- Page colour (MainActivity.setPageColor)

  // The app paints the area behind the navigation bar (and the next launch's splash) in Zalo's page
  // colour, which follows Zalo's light/dark theme. The theme flips classes on <body>, so the colour is
  // only re-read when the classes change.
  window.__zwReportPageColor = function () {
    var body = document.body;
    var key = location.hostname + '|' + root.className + '|' + (body ? body.className : '');
    if (window.__zwPageColorKey === key) return;
    window.__zwPageColorKey = key;
    var raw = location.hostname !== 'chat.zalo.me' ? '#ffffff'
      : body ? getComputedStyle(body).getPropertyValue('--layer-background').trim() : '';
    if (!raw) {
      window.__zwPageColorKey = null; // Zalo's stylesheet isn't loaded yet: try again on the next change
      return;
    }
    // A canvas normalises any CSS colour ("#fff", "rgb(...)") to "#rrggbb".
    var ctx = window.__zwColorCtx || (window.__zwColorCtx = document.createElement('canvas').getContext('2d'));
    ctx.fillStyle = '#000000';
    ctx.fillStyle = raw;
    var color = ctx.fillStyle;
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === window.__zwPageColor) return;
    window.__zwPageColor = color;
    try { bridge.pageColor(color); } catch (e) { /* not running inside the app */ }
  };
  window.__zwReportPageColor();

  // Zalo re-renders the composer per conversation and updates tab badges/selection in place:
  // re-add the "⋯" button and refresh the tab bar after DOM changes (at most once per frame).
  if (!window.__zwSkinObserver && document.body) {
    var skinQueued = false;
    window.__zwSkinObserver = new MutationObserver(function () {
      if (skinQueued) return;
      skinQueued = true;
      requestAnimationFrame(function () {
        skinQueued = false;
        window.__zwEnsureToolsToggle();
        window.__zwRenderTabBar();
        window.__zwSyncOpening();
        window.__zwReportPageColor();
      });
    });
    window.__zwSkinObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']
    });
  }

  // ---------------------------------------------------------------- Splash (MainActivity.hideSplash)

  // Keep the native splash up until Zalo has rendered its UI (or we are on the login page).
  if (!window.__zwReadySent) {
    var readyTries = 0;
    (function waitForApp() {
      var ready = location.hostname !== 'chat.zalo.me' || document.querySelector('#container, #sidebarNav');
      if (ready || ++readyTries > 150) {
        window.__zwReadySent = true;
        try { bridge.ready(); } catch (e) { /* not running inside the app */ }
        return;
      }
      setTimeout(waitForApp, 100);
    })();
  }

  // ---------------------------------------------------------------- Back button (MainActivity.handleBack)

  // Zalo opens chats/panels without touching history, so Back must close them by hand:
  // popup/modal/viewer (Escape, then its close button) -> chat-list search -> conversation info
  // panel -> conversation -> let Android decide.
  // Closing a chat animates for ~0.9s with the back button still mounted; swallow repeats meanwhile.
  var CHAT_CLOSE_MS = 1500;
  var MIN_OVERLAY_PX = 8;
  // Kept on window so a re-injection in the middle of a Back sequence doesn't reset it.
  var backState = window.__zwBackState || (window.__zwBackState = {
    overlay: null, presses: 0, lastChatClose: 0, stuck: new WeakSet()
  });

  function isShown(el, minSize) {
    if (!el) return false;
    var min = minSize || 1;
    var r = el.getBoundingClientRect();
    if (r.width < min || r.height < min) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  // Zalo renders popovers, modals and the media viewer as direct children of <body>. Tiny or
  // click-through nodes (toasts, tooltips) and ones that already ignored two Backs don't count.
  function isOverlay(el) {
    if (el.id === 'app' || el.id === 'zw-tabbar' || el.id === 'zw-opening') return false;
    if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|IFRAME)$/.test(el.tagName)) return false;
    if (backState.stuck.has(el) || !isShown(el, MIN_OVERLAY_PX)) return false;
    return getComputedStyle(el).pointerEvents !== 'none';
  }

  function topOverlay() {
    var kids = document.body ? document.body.children : [];
    for (var i = kids.length - 1; i >= 0; i--) {
      if (isOverlay(kids[i])) return kids[i];
    }
    return null;
  }

  function pressEscape() {
    var target = document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(function (type) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
    });
  }

  // On a touch screen :hover and Zalo's own row hover state ("⋯" in place of the time) stick to the
  // chat-list row that was tapped to open the chat. Before the list shows again without a new touch
  // (swipe back, system Back), tell Zalo the mouse left it; zalo-mobile.css drops the :hover look.
  function leaveListRows() {
    Array.prototype.forEach.call(document.querySelectorAll('#conversationListId .conv-item:hover'), function (row) {
      row.dispatchEvent(new MouseEvent('mouseout', {
        bubbles: true, cancelable: true, composed: true, view: window, relatedTarget: document.body
      }));
    });
  }

  // Returns true when something inside Zalo was closed.
  window.__zwBack = function () {
    // A chat is still opening behind the placeholder: cancel the placeholder, stay in the app.
    if (document.getElementById('zw-opening') && !document.querySelector('.conv-back-btn')) {
      if (window.__zwCancelOpening) window.__zwCancelOpening();
      return true;
    }
    var overlay;
    while ((overlay = topOverlay())) {
      if (overlay !== backState.overlay) {
        backState.overlay = overlay;
        backState.presses = 0;
      }
      if (backState.presses < 2) {
        backState.presses++;
        var close = backState.presses > 1 && overlay.querySelector('.modal-header-icon, [class*="close"]');
        if (close) close.click(); else pressEscape();
        return true;
      }
      // Ignored both Escape and its close button: skip it and look underneath.
      backState.stuck.add(overlay);
      backState.overlay = null;
    }
    backState.overlay = null;

    // Chat-list search mode swaps the header icons for a text "Đóng" button.
    var searchClose = document.querySelector('#contact-search .z--btn--v2:not(.icon-only)');
    if (isShown(searchClose)) {
      // Blur first: Zalo ignores "Đóng" while the search box still has focus, and a focused
      // box would also keep the keyboard up.
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      searchClose.click();
      return true;
    }
    // Side panels with their own X that ignore Escape, e.g. "Tìm kiếm trong trò chuyện"
    // (.search-message-panel-compact.--show).
    var panelClose = Array.prototype.filter.call(
      document.querySelectorAll('#app .--show .fa-Close_24_Line, #app aside .fa-Close_24_Line'),
      function (icon) { return isShown(icon); }
    )[0];
    if (panelClose) {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      (panelClose.closest('.z--btn--v2') || panelClose).click();
      return true;
    }
    var infoToggle = document.querySelector('#header .fa-outline-right-bar-active');
    if (isShown(infoToggle)) {
      (infoToggle.closest('.z--btn--v2') || infoToggle).click();
      return true;
    }
    var convBack = document.querySelector('.conv-back-btn');
    if (isShown(convBack)) {
      var now = Date.now();
      if (now - backState.lastChatClose > CHAT_CLOSE_MS) {
        backState.lastChatClose = now;
        leaveListRows();
        convBack.click();
      }
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- Swipes in a chat

  // Phone-app gestures in an open conversation (skin on):
  //  - swipe right anywhere in it (messages, background, header): the chat page follows the finger
  //    with the chat list underneath, as in the iOS / Telegram apps. Let go far or fast enough and
  //    it slides away and the chat closes; otherwise it slides back.
  //  - swipe a message left to reply to it: the message follows the finger, and a reply arrow
  //    beside it fills in and turns blue with a haptic tick once letting go will reply.
  // zalo-mobile.css gives those areas "touch-action: pan-y", so vertical drags still scroll
  // natively (and end here in pointercancel) while horizontal drags are left to this code.
  var SWIPE_SLOP_PX = 10;
  var SWIPE_REPLY_PX = 56;
  var SWIPE_SETTLE_MS = 200; // .zw-swipe-settle in zalo-mobile.css
  var SWIPE_FOCUS_MS = 1000;
  var REPLY_WAIT_MS = 600;
  var UNHOVER_MS = 300;
  var BACK_CLOSE_AT = 0.35; // of the page width
  var BACK_FLING_PX_MS = 0.35; // rightwards speed when the finger lets go that closes it anyway
  var BACK_STILL_MS = 80; // a finger that stopped this long before letting go has no speed
  var BACK_PARALLAX = 0.3; // the list starts this far (of the width) to the left
  var BACK_SHADE = 0.12; // and this much darker
  var BACK_SETTLE_MS = 250; // html.zw-back-settle in zalo-mobile.css
  var BACK_CLOSE_WAIT_MS = 2500;
  var SWIPE_AREA = '#messageViewContainer, #chatViewContainer #header';
  var BUBBLE = '[id^="message-frame_"]';
  var swipe = null;
  var backSlide = null;

  // Zalo renders a message's quick actions (Trả lời / Chia sẻ / Thêm) only while the mouse is
  // over it, 0.1-0.2 s after mouseover. So a reply swipe "hovers" its message as soon as it starts,
  // and the reply button is there by the time the finger lets go. html.zw-swiping keeps that
  // toolbar (and the 👍 the finger's :hover shows) invisible until Zalo has taken it down again.
  function hoverMessage(bubble, on) {
    clearTimeout(window.__zwUnhoverTimer);
    if (on) root.classList.add('zw-swiping');
    bubble.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', {
      bubbles: true, cancelable: true, composed: true, view: window,
      relatedTarget: on ? null : document.body
    }));
    if (!on) {
      window.__zwUnhoverTimer = setTimeout(function () { root.classList.remove('zw-swiping'); }, UNHOVER_MS);
    }
  }

  function replyButton(row) {
    var icon = row.querySelector('.MSABtn-btn .fa-Quote_24_Filled');
    return icon && icon.closest('.MSABtn-btn');
  }

  function reply(s) {
    var since = Date.now();
    (function attempt() {
      var btn = s.row.isConnected && replyButton(s.row);
      if (!btn && Date.now() - since < REPLY_WAIT_MS) {
        setTimeout(attempt, 20);
        return;
      }
      if (btn) {
        // Zalo then focuses the message box; let it, so the keyboard opens as in the app
        // (see "No surprise keyboard" below).
        window.__zwFocusAllowedUntil = Date.now() + SWIPE_FOCUS_MS;
        btn.click();
      }
      hoverMessage(s.bubble, false);
    })();
  }

  function replyHint() {
    var el = document.createElement('div');
    el.className = 'zw-swipe-hint';
    var icon = document.createElement('i');
    icon.className = 'fa fa-Quote_24_Filled';
    el.appendChild(icon);
    document.body.appendChild(el);
    return el;
  }

  // The chat page (Zalo's <main>) slides. Under it, the chat list (#sidebarNav, kept laid out but
  // hidden while a chat is open, see zalo-mobile.css) and the tab bar come in from a little to the
  // left, under a shade that lifts as the page goes.
  function startBack() {
    var page = document.querySelector('#container main');
    if (!page) return false;
    leaveListRows();
    var shade = document.createElement('div');
    shade.id = 'zw-back-shade';
    document.body.appendChild(shade);
    backSlide = {
      page: page, shade: shade, width: innerWidth,
      under: [document.getElementById('sidebarNav'), document.getElementById('zw-tabbar')].filter(Boolean)
    };
    root.classList.add('zw-back');
    return true;
  }

  function placeBack(x) {
    var b = backSlide;
    var progress = Math.min(1, Math.max(0, x / b.width));
    b.page.style.transform = 'translate3d(' + Math.round(x) + 'px,0,0)';
    var under = 'translate3d(' + Math.round((progress - 1) * b.width * BACK_PARALLAX) + 'px,0,0)';
    b.under.forEach(function (el) { el.style.transform = under; });
    b.shade.style.opacity = String((1 - progress) * BACK_SHADE);
  }

  function finishBack() {
    var b = backSlide;
    backSlide = null;
    root.classList.remove('zw-back', 'zw-back-settle');
    b.page.style.transform = '';
    b.under.forEach(function (el) { el.style.transform = ''; });
    b.shade.remove();
  }

  // Let go at x (px) moving at vx (px/ms): slide the rest of the way and close the chat, or back.
  // The chat is closed only once the page is out of sight: Zalo swaps it for the list within a
  // frame, and the list is already in place by then.
  function releaseBack(x, vx) {
    var close = vx > BACK_FLING_PX_MS || (vx > -0.1 && x > backSlide.width * BACK_CLOSE_AT);
    root.classList.add('zw-back-settle');
    placeBack(close ? backSlide.width : 0);
    setTimeout(function () {
      var btn = close && document.querySelector('#chatViewContainer .conv-back-btn');
      if (!btn) {
        finishBack();
        return;
      }
      backState.lastChatClose = Date.now(); // a Back press right after doesn't close it twice
      btn.click();
      var since = Date.now();
      (function waitForList() {
        if (document.querySelector('#chatViewContainer .conv-back-btn') &&
            Date.now() - since < BACK_CLOSE_WAIT_MS) {
          requestAnimationFrame(waitForList);
          return;
        }
        finishBack();
      })();
    }, BACK_SETTLE_MS);
  }

  // A touch that never became a swipe: a tap, a scroll, a drag to the left off the messages.
  function dropSwipe(s) {
    swipe = null;
    if (s.row) root.classList.remove('zw-swiping');
  }

  function endSwipe(act, ev) {
    var s = swipe;
    if (!s) return;
    if (!s.started) {
      dropSwipe(s);
      return;
    }
    swipe = null;
    if (!s.reply) {
      if (s.row) root.classList.remove('zw-swiping');
      var still = !ev || ev.timeStamp - s.lastAt > BACK_STILL_MS;
      releaseBack(act ? s.dx : 0, act && !still ? s.vx : 0);
      return;
    }
    s.hint.remove();
    var row = s.row;
    row.classList.add('zw-swipe-settle');
    row.style.transform = '';
    setTimeout(function () { row.classList.remove('zw-swipe-settle'); }, SWIPE_SETTLE_MS);
    if (act && s.armed) reply(s); else hoverMessage(s.bubble, false);
  }

  var swipeHandlers = {};

  swipeHandlers.pointerdown = function (ev) {
    endSwipe(false);
    if (backSlide || ev.pointerType !== 'touch' || !ev.isPrimary || !root.classList.contains('zw-skin')) return;
    var target = ev.target;
    if (!target || !target.closest || !target.closest(SWIPE_AREA) ||
        !document.getElementById('messageViewContainer') ||
        !document.querySelector('#chatViewContainer .conv-back-btn')) return;
    var bubble = target.closest(BUBBLE);
    var row = bubble && bubble.closest('.chat-message');
    if (row) {
      clearTimeout(window.__zwUnhoverTimer);
      root.classList.add('zw-swiping');
    }
    swipe = {
      id: ev.pointerId, x: ev.clientX, y: ev.clientY, target: target, bubble: row ? bubble : null,
      row: row, reply: false, started: false, armed: false, dx: 0, vx: 0, lastX: 0, lastAt: 0
    };
  };

  swipeHandlers.pointermove = function (ev) {
    var s = swipe;
    if (!s || ev.pointerId !== s.id) return;
    var dx = ev.clientX - s.x;
    var dy = ev.clientY - s.y;
    if (!s.started) {
      if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
      if (Math.abs(dy) > Math.abs(dx) || (dx < 0 && !s.row) || (dx > 0 && !startBack())) {
        dropSwipe(s); // mostly vertical, or to the left off the messages: not ours
        return;
      }
      s.started = true;
      s.reply = dx < 0;
      s.x = ev.clientX; // count from here, so nothing jumps by the slop
      s.lastX = ev.clientX;
      s.lastAt = ev.timeStamp;
      // The finger now drags rather than rests on what it touched: Zalo shows some hints while a
      // finger is down (e.g. "Đã có trên Cloud" on a file) and hides them on touchend.
      try {
        var touch = new Touch({ identifier: ev.pointerId, target: s.target, clientX: ev.clientX, clientY: ev.clientY });
        s.target.dispatchEvent(new TouchEvent('touchend', {
          bubbles: true, cancelable: true, composed: true, view: window,
          touches: [], targetTouches: [], changedTouches: [touch]
        }));
      } catch (e) { /* no Touch constructor */ }
      if (s.reply) {
        s.hint = replyHint();
        hoverMessage(s.bubble, true);
        // Level with the middle of the bubble's visible part.
        var r = s.bubble.getBoundingClientRect();
        var y = (Math.max(r.top, 56) + Math.min(r.bottom, innerHeight - 56)) / 2;
        s.hint.style.top = Math.round(y - 18) + 'px';
      }
      dx = 0;
    }
    s.dx = dx;
    if (!s.reply) {
      var dt = ev.timeStamp - s.lastAt;
      if (dt > 0) {
        s.vx = 0.6 * (ev.clientX - s.lastX) / dt + 0.4 * s.vx;
        s.lastX = ev.clientX;
        s.lastAt = ev.timeStamp;
      }
      placeBack(Math.max(0, dx));
      return;
    }
    var pull = Math.max(0, -dx);
    // Past the point where it acts, the message keeps following at a third of the speed.
    var offset = pull <= SWIPE_REPLY_PX ? pull : SWIPE_REPLY_PX + (pull - SWIPE_REPLY_PX) / 3;
    var progress = Math.min(1, pull / SWIPE_REPLY_PX);
    s.row.style.transform = 'translateX(' + (-offset) + 'px)';
    s.hint.style.transform = 'scale(' + (0.5 + progress / 2) + ')';
    s.hint.style.opacity = String(progress);
    var armed = pull >= SWIPE_REPLY_PX;
    if (armed !== s.armed) {
      s.armed = armed;
      s.hint.classList.toggle('zw-swipe-hint--armed', armed);
      if (armed) {
        try { bridge.haptic(); } catch (e) { /* older app or not running inside it */ }
      }
    }
  };

  swipeHandlers.pointerup = function (ev) {
    if (swipe && ev.pointerId === swipe.id) endSwipe(true, ev);
  };

  swipeHandlers.pointercancel = function (ev) {
    if (swipe && ev.pointerId === swipe.id) endSwipe(false, ev);
  };

  // On document, capture phase. Replaced on every injection, like the opening click above.
  var oldSwipeHandlers = window.__zwSwipeHandlers || {};
  Object.keys(oldSwipeHandlers).forEach(function (type) {
    document.removeEventListener(type, oldSwipeHandlers[type], true);
  });
  window.__zwSwipeHandlers = swipeHandlers;
  Object.keys(swipeHandlers).forEach(function (type) {
    document.addEventListener(type, swipeHandlers[type], true);
  });

  // ---------------------------------------------------------------- Hooks below install once per page

  if (window.__zwHooked) return;
  window.__zwHooked = true;

  // ---------------------------------------------------------------- No surprise keyboard

  // Zalo focuses the message box whenever a chat opens; on a phone that pops the keyboard.
  // Only allow focusing a text field when:
  //  - the user just touched it or right next to it (Zalo's editor only turns contenteditable on
  //    while focused, so the touch lands on a child or sibling),
  //  - it is the same field that lost focus a moment ago (Zalo restoring focus after Send), or
  //  - the browser is giving focus back to it after the app/window was away (dialogs, app switch), or
  //  - a swipe-to-reply just asked for it (window.__zwFocusAllowedUntil).
  var FOCUS_GRACE_MS = 1000;
  var NEAR_LEVELS = 4;
  var lastDown = null;
  var lastDownAt = 0;
  var lastField = null;
  var lastFieldBlurAt = 0;
  var awayElement = null;
  var blocking = false;

  function touchedNear(field) {
    if (!lastDown || Date.now() - lastDownAt > FOCUS_GRACE_MS) return false;
    for (var n = lastDown, i = 0; n && i <= NEAR_LEVELS; n = n.parentElement, i++) {
      if (n.contains(field)) return true;
    }
    return false;
  }

  function editableOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === 'TEXTAREA') return el;
    if (el.tagName === 'INPUT') {
      return /^(text|search|email|tel|url|password|number|)$/.test(el.type || '') ? el : null;
    }
    return el.closest ? el.closest('[contenteditable=""], [contenteditable="true"]') : null;
  }

  // The focused element is kept while the window is away; it gets focus back on return.
  window.addEventListener('blur', function () {
    awayElement = document.activeElement !== document.body ? document.activeElement : null;
  });

  document.addEventListener('pointerdown', function (ev) {
    lastDown = ev.target;
    lastDownAt = Date.now();
    awayElement = null;
  }, true);

  document.addEventListener('focusin', function (ev) {
    var field = editableOf(ev.target);
    if (!field) return;
    var returning = !!awayElement && (awayElement === ev.target || awayElement.contains(field) ||
      field.contains(awayElement));
    awayElement = null;
    if (returning || touchedNear(field) || Date.now() < (window.__zwFocusAllowedUntil || 0) ||
        (field === lastField && Date.now() - lastFieldBlurAt < FOCUS_GRACE_MS)) {
      return;
    }
    // Stop the event before Zalo's own focus handlers run, so its state stays "not focused".
    ev.stopImmediatePropagation();
    blocking = true; // our own blur must not count as "lost focus a moment ago"
    field.blur();
    blocking = false;
  }, true);

  document.addEventListener('focusout', function (ev) {
    if (blocking) return;
    var field = editableOf(ev.target);
    if (field) {
      lastField = field;
      lastFieldBlurAt = Date.now();
    }
  }, true);

  // ---------------------------------------------------------------- Long-press = right-click

  // A long-press makes WebView fire contextmenu with button -1 and an ancestor (e.g. the date
  // block) as target, so Zalo's message / conversation menus never open. Re-send it as a
  // right-click on the element the finger actually touched. Text fields keep their own
  // long-press (select / paste).
  var touchDown = null;

  document.addEventListener('pointerdown', function (ev) {
    touchDown = ev.pointerType === 'touch'
      ? { el: ev.target, x: ev.clientX, y: ev.clientY, at: Date.now() }
      : null;
  }, true);

  document.addEventListener('contextmenu', function (ev) {
    if (ev.button === 2 || !touchDown || Date.now() - touchDown.at > 2000) return;
    var down = touchDown;
    touchDown = null;
    if (editableOf(down.el)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    down.el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 2, buttons: 2, clientX: down.x, clientY: down.y, screenX: down.x, screenY: down.y
    }));
  }, true);

  // ---------------------------------------------------------------- Downloads

  // Zalo revokes blob URLs right after clicking, so keep the original Blob around ourselves,
  // bounded by count and total size, and dropped a while after Zalo revokes it.
  var MAX_BLOBS = 40;
  var MAX_BLOB_BYTES = 64 * 1024 * 1024;
  var REVOKED_KEEP_MS = 30000;
  var blobs = new Map();
  var blobBytes = 0;

  function forgetBlob(url) {
    var b = blobs.get(url);
    if (!b) return;
    blobBytes -= b.size;
    blobs.delete(url);
  }

  var origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var url = origCreateObjectURL.apply(this, arguments);
    try {
      if (obj instanceof Blob && obj.size <= MAX_BLOB_BYTES) {
        forgetBlob(url);
        blobs.set(url, obj);
        blobBytes += obj.size;
        while (blobs.size > MAX_BLOBS || blobBytes > MAX_BLOB_BYTES) forgetBlob(blobs.keys().next().value);
      }
    } catch (e) { /* never break the page */ }
    return url;
  };

  var origRevokeObjectURL = URL.revokeObjectURL;
  URL.revokeObjectURL = function (url) {
    setTimeout(forgetBlob, REVOKED_KEEP_MS, url);
    return origRevokeObjectURL.apply(this, arguments);
  };

  function report(msg) {
    try { bridge.toast(msg); } catch (e) { console.error(msg); }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result);
        resolve(s.substring(s.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  // Stream the file to Android in chunks so a large video never becomes one giant string.
  var CHUNK_BYTES = 768 * 1024;

  function saveBlob(blob, name, mime) {
    var fileName = name || (typeof File !== 'undefined' && blob instanceof File ? blob.name : '');
    var id = bridge.beginSave(fileName || '', mime || blob.type || '');
    if (!id) return Promise.resolve(); // Android already reported why
    var offset = 0;
    function next() {
      if (offset >= blob.size) {
        bridge.finishSave(id);
        return undefined;
      }
      var part = blob.slice(offset, offset + CHUNK_BYTES);
      offset += CHUNK_BYTES;
      return blobToBase64(part).then(function (b64) {
        if (!bridge.appendSave(id, b64)) return undefined; // aborted and reported by Android
        return next();
      });
    }
    return Promise.resolve().then(next).catch(function (e) {
      bridge.abortSave(id);
      throw e;
    });
  }

  function saveUrl(url, name, mime) {
    if (!bridge) return Promise.resolve();
    var source;
    if (url.indexOf('data:') === 0) {
      var comma = url.indexOf(',');
      var header = url.substring(5, comma);
      if (header.indexOf(';base64') >= 0) {
        bridge.saveBase64(url.substring(comma + 1), name || '', mime || header.split(';')[0] || '');
        return Promise.resolve();
      }
      source = fetch(url).then(function (r) { return r.blob(); });
    } else {
      var kept = blobs.get(url);
      source = kept ? Promise.resolve(kept) : fetch(url).then(function (r) { return r.blob(); });
    }
    return source
      .then(function (blob) { return saveBlob(blob, name, mime); })
      .catch(function (e) { report('Không tải được file: ' + (e && e.message ? e.message : e)); });
  }
  window.__zwSaveUrl = saveUrl;

  function isDownloadAnchor(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = a.href || '';
    return href.indexOf('blob:') === 0 || href.indexOf('data:') === 0;
  }

  function saveAnchor(a) {
    saveUrl(a.href, a.getAttribute('download') || '', a.type || '');
  }

  // Programmatic <a download>.click(), usually on a detached element.
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownloadAnchor(this)) {
      saveAnchor(this);
      return;
    }
    return origClick.apply(this, arguments);
  };

  // a.dispatchEvent(new MouseEvent('click')) variant.
  var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && isDownloadAnchor(this)) {
      saveAnchor(this);
      return false;
    }
    return origDispatch.apply(this, arguments);
  };

  // Real taps on an <a download> that is in the document.
  document.addEventListener('click', function (ev) {
    var target = ev.target;
    var a = target && target.closest ? target.closest('a') : null;
    if (isDownloadAnchor(a)) {
      ev.preventDefault();
      saveAnchor(a);
    }
  }, true);
})();
