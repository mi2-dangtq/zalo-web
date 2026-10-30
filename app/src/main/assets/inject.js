// Injected by MainActivity.injectAll() after every page load and settings change.
// window.__zwConfig = { viewport: <px, 0 = auto>, css: <base css>, mobileCss: <zalo-mobile css or ''>,
//                       customCss: <user css>, systemFont: <url of the phone's font or ''> }
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

  // "Font của máy": the phone's own font (served by the app, see SystemFont.kt) in place of Zalo's
  // Segoe UI. Re-declaring Zalo's font families at every weight wins over Zalo's own faces (the
  // face declared last wins), so all text keeps its CSS and Zalo's icon font is left alone. If the
  // file fails to load, Zalo's own face is used.
  function systemFontCss(url) {
    if (!url) return '';
    var css = '';
    ['SegoeuiPc', 'SegoeuiPcText'].forEach(function (family) {
      for (var weight = 100; weight <= 900; weight += 100) {
        css += '@font-face{font-family:' + family + ';src:url("' + url + '");font-weight:' + weight +
          ';font-style:normal;font-display:block}';
      }
    });
    return css;
  }

  setStyle('zw-base', cfg.css || '');
  setStyle('zw-mobile', cfg.mobileCss || '');
  setStyle('zw-font', systemFontCss(cfg.systemFont));
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

  // Runs after every batch of Zalo DOM changes, so it only searches the composer bar when it can.
  window.__zwEnsureToolsToggle = function () {
    if (!root.classList.contains('zw-skin')) {
      var stray = document.querySelector('.zw-tools-toggle');
      if (stray) stray.remove();
      return;
    }
    var bar = document.getElementById('chat-box-bar-id');
    if (!bar || bar.querySelector('.zw-tools-toggle')) return;
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

  // Zalo's zCloud upsell at the top of the chat list is hidden by zalo-mobile.css, but the list
  // still lays its rows out below it, leaving a ~72px blank. Its own "Đóng" makes Zalo drop it and
  // move the chats up (Zalo remembers that); it is closed again whenever it comes back.
  window.__zwCloseListBanner = function () {
    var list = root.classList.contains('zw-skin') && document.getElementById('conversationList');
    var close = list && list.querySelector('.conversation-list__banner__full-mode .conversation-list__banner__close');
    if (!close || close.__zwClicked) return;
    close.__zwClicked = true;
    close.click();
  };
  window.__zwCloseListBanner();

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

  var TAB_RESYNC_MS = 800;

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
        if (item.dataset.title === 'My Documents' && !chatOpen()) {
          window.__zwOpenBehindPlaceholder('My Documents', function () { tab.click(); });
          return;
        }
        // Zalo takes 0.1-0.2 s to switch tabs with nothing moving meanwhile: light the tapped tab
        // up first and hand the tap over once that frame is on screen. The bar is then redrawn
        // from the rail, in case Zalo didn't switch. Cài đặt only opens a menu.
        if (item.dataset.title !== 'Cài đặt' && !item.classList.contains('zw-tab--selected')) {
          Array.prototype.forEach.call(bar.querySelectorAll('.zw-tab'), function (t) {
            t.classList.toggle('zw-tab--selected', t === item);
          });
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              tab.click();
              bar.__zwSignature = null;
              setTimeout(window.__zwRenderTabBar, TAB_RESYNC_MS);
            });
          });
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

  // A conversation is open (the Danh bạ pages have a back button too, to Zalo's menu of them).
  function chatOpen() {
    return !!document.querySelector('.conv-back-btn:not(.contact-pages .conv-back-btn)');
  }
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
    if (!el || el.classList.contains('zw-opening--done')) return;
    var age = Date.now() - el.__zwShownAt;
    var arrived = !!document.querySelector('#chatViewContainer #header') || chatOpen();
    if (arrived && el.__zwCloseOnArrival && age <= OPENING_MAX_MS) {
      // Back was pressed while Zalo was opening it (see back() below): it leaves once it can slide.
      if (!chatSlidable()) return;
      window.__zwHideOpening();
      slideChatClosed();
      return;
    }
    if ((age >= OPENING_SLIDE_MS && arrived) || age > OPENING_MAX_MS) window.__zwHideOpening();
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
      if (!el.isConnected || el.classList.contains('zw-opening--done')) return;
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
        el.__zwOpened = true;
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
    // Our own zw-* classes (flipped by every swipe and keyboard slide) don't change the colour.
    var key = location.hostname + '|' + root.className.replace(/\bzw-\S+/g, '') + '|' +
      (body ? body.className : '');
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
        window.__zwCloseListBanner();
        window.__zwRenderTabBar();
        window.__zwSyncOpening();
        window.__zwReportPageColor();
        window.__zwReportViewer();
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
  // panel -> conversation (slides away as a swipe right does) -> let Android decide.
  // Zalo's own close (a Danh bạ page, or a chat without the skin) animates for ~0.9s with the back
  // button still mounted; swallow repeats meanwhile. A chat with the skin slides away instead.
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
      // One that ignored Back and has since gone away may be reused for the next popup.
      if (backState.stuck.has(kids[i]) && !isShown(kids[i], MIN_OVERLAY_PX)) backState.stuck.delete(kids[i]);
      if (isOverlay(kids[i])) return kids[i];
    }
    return null;
  }

  // Clicks anything: an SVG icon (which some close buttons are) has no click().
  function tap(el) {
    if (typeof el.click === 'function') {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
    }
  }

  // The back button of what is on screen: Danh bạ keeps its pages' (hidden) one while a chat is open.
  function shownConvBack() {
    return Array.prototype.filter.call(document.querySelectorAll('.conv-back-btn'), function (b) {
      return isShown(b);
    })[0] || null;
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

  // Returns true when something inside Zalo was closed (or is being closed). A script error stays
  // in the app too: MainActivity would otherwise send the app to the background.
  window.__zwBack = function () {
    try {
      return back();
    } catch (e) {
      console.error('zw back', e);
      return true;
    }
  };

  function back() {
    // A chat page is already sliding away (a swipe let go, or the Back before).
    if (sliding()) return true;
    var opening = document.getElementById('zw-opening');
    if (opening && !chatOpen()) {
      // A chat is still opening behind the placeholder. If its tap hasn't reached Zalo yet, drop
      // it; if it has, the chat can't be stopped, so it slides away as soon as it is there.
      if (opening.__zwOpened) opening.__zwCloseOnArrival = true;
      else if (window.__zwCancelOpening) window.__zwCancelOpening();
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
        if (close) tap(close); else pressEscape();
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
      tap(searchClose);
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
      tap(panelClose.closest('.z--btn--v2') || panelClose);
      return true;
    }
    var infoToggle = document.querySelector('#header .fa-outline-right-bar-active');
    if (isShown(infoToggle)) {
      tap(infoToggle.closest('.z--btn--v2') || infoToggle);
      return true;
    }
    var convBack = shownConvBack();
    if (convBack) {
      // A chat leaves as a swipe right lets it go.
      if (chatSlidable() && slideChatClosed()) return true;
      // The Danh bạ pages (and no skin): Zalo's own close keeps the button up for a while.
      var now = Date.now();
      if (now - backState.lastChatClose > CHAT_CLOSE_MS) {
        backState.lastChatClose = now;
        window.__zwClosingChatAt = now;
        leaveListRows();
        tap(convBack);
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Swipes in a chat

  // Phone-app gestures in an open conversation (skin on):
  //  - swipe right anywhere in it (messages, background, header): the chat page follows the finger
  //    with the chat list underneath, as in the iOS / Telegram apps. Let go far or fast enough and
  //    it slides away and the chat closes; otherwise it slides back. Back (the edge gesture or the
  //    Back button) plays the same slide-away without a finger: HyperOS keeps the screen edges for
  //    its own gesture and reports it only once the finger lifts, so that one can't follow it.
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
  var SLIDE_STALE_MS = 6000; // far longer than any slide; one still marked after that was left over
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

  // A conversation is open with the skin on: the page that swipes and Back slide away.
  function chatSlidable() {
    return root.classList.contains('zw-skin') && !!document.getElementById('messageViewContainer') &&
      !!document.querySelector('#chatViewContainer .conv-back-btn');
  }

  // A chat page is sliding: this run's own slide, or one an earlier injection of this script
  // started (html.zw-back stays on until that one finishes). One marked for longer than any slide
  // takes was left over: it is cleared, so Back and swipes never stay blocked.
  function sliding() {
    if (!backSlide && !root.classList.contains('zw-back')) return false;
    if (Date.now() - (window.__zwBackSlideAt || 0) < SLIDE_STALE_MS) return true;
    if (backSlide) {
      finishBack();
    } else {
      root.classList.remove('zw-back', 'zw-back-settle');
      Array.prototype.forEach.call(document.querySelectorAll('#zw-back-shade'), function (s) { s.remove(); });
      ['#container main', '#sidebarNav', '#zw-tabbar'].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (el) el.style.transform = '';
      });
    }
    return false;
  }

  // The chat page (Zalo's <main>) slides. Under it, the chat list (#sidebarNav, kept laid out but
  // hidden while a chat is open, see zalo-mobile.css) and the tab bar come in from a little to the
  // left, under a shade that lifts as the page goes.
  function startBack() {
    var page = document.querySelector('#container main');
    if (!page || sliding()) return false;
    leaveListRows();
    var shade = document.createElement('div');
    shade.id = 'zw-back-shade';
    document.body.appendChild(shade);
    backSlide = {
      page: page, shade: shade, width: innerWidth,
      under: [document.getElementById('sidebarNav'), document.getElementById('zw-tabbar')].filter(Boolean)
    };
    window.__zwBackSlideAt = Date.now();
    root.classList.add('zw-back');
    return true;
  }

  function placeBack(x) {
    var b = backSlide;
    if (!b) return;
    var progress = Math.min(1, Math.max(0, x / b.width));
    b.page.style.transform = 'translate3d(' + Math.round(x) + 'px,0,0)';
    var under = 'translate3d(' + Math.round((progress - 1) * b.width * BACK_PARALLAX) + 'px,0,0)';
    b.under.forEach(function (el) { el.style.transform = under; });
    b.shade.style.opacity = String((1 - progress) * BACK_SHADE);
  }

  function finishBack() {
    var b = backSlide;
    if (!b) return;
    backSlide = null;
    root.classList.remove('zw-back', 'zw-back-settle');
    b.page.style.transform = '';
    b.under.forEach(function (el) { el.style.transform = ''; });
    b.shade.remove();
  }

  // Let go at x (px) moving at vx (px/ms): slide the rest of the way and close the chat, or back.
  function releaseBack(x, vx) {
    if (!backSlide) return;
    settleBack(vx > BACK_FLING_PX_MS || (vx > -0.1 && x > backSlide.width * BACK_CLOSE_AT));
  }

  // Back on an open chat: the page starts in place, with the list and shade where a swipe would
  // start them. Reading a style makes the browser settle that start now, as a frame would, so the
  // list and the shade move too (a transition starts from the last style the browser computed).
  function slideChatClosed() {
    if (!startBack()) return false;
    placeBack(0);
    getComputedStyle(backSlide.shade).opacity;
    settleBack(true);
    return true;
  }

  // The page slides the rest of the way out and the chat closes, or slides back into place.
  // The chat is closed only once the page is out of sight: Zalo swaps it for the list within a
  // frame, and the list is already in place by then. Each slide clicks Zalo's back button once:
  // Back is swallowed while it runs (see sliding()), so nothing else can have closed the chat.
  function settleBack(close) {
    root.classList.add('zw-back-settle');
    placeBack(close ? backSlide.width : 0);
    setTimeout(function () {
      var btn = close && document.querySelector('#chatViewContainer .conv-back-btn');
      if (!btn) {
        finishBack();
        return;
      }
      window.__zwClosingChatAt = Date.now();
      tap(btn);
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
    if (ev.pointerType !== 'touch' || !ev.isPrimary || sliding()) return;
    var target = ev.target;
    if (!target || !target.closest || !target.closest(SWIPE_AREA) || !chatSlidable()) return;
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

  // A long-press opened Zalo's menu (see "Long-press = right-click"): the finger drifting on from
  // there must not start a swipe under the menu.
  window.__zwDropSwipe = function () {
    if (swipe && !swipe.started) dropSwipe(swipe);
  };

  // On document, capture phase. Replaced on every injection, like the opening click above. A
  // gesture the previous run was in the middle of ends first (it would never see its pointerup):
  // its page slides back, its reply arrow goes.
  if (window.__zwEndGesture) window.__zwEndGesture();
  window.__zwEndGesture = function () { endSwipe(false); };
  var oldSwipeHandlers = window.__zwSwipeHandlers || {};
  Object.keys(oldSwipeHandlers).forEach(function (type) {
    document.removeEventListener(type, oldSwipeHandlers[type], true);
  });
  window.__zwSwipeHandlers = swipeHandlers;
  Object.keys(swipeHandlers).forEach(function (type) {
    document.addEventListener(type, swipeHandlers[type], true);
  });

  // ---------------------------------------------------------------- Photo viewer

  // Zalo's photo viewer (.image-show-modal, a child of <body>) is its desktop one: zalo-mobile.css
  // lays it out edge to edge on black, and with the skin on it takes phone gestures here:
  //  - swipe left / right: the photo follows the finger and the next / previous one comes in
  //    (Zalo's own ↓ / ↑ buttons, which the skin hides);
  //  - pinch, or double-tap, to zoom; drag a zoomed photo to move it;
  //  - swipe down: the photo follows the finger and the viewer fades; let go far or fast enough
  //    and it closes;
  //  - a tap hides or shows the title and tool bars. Zalo closes the viewer on any click on the
  //    photo, so those clicks never reach it.
  // The zoom is a transform of our own on .photo-player-container, which fills the viewer and
  // holds Zalo's centred (and maybe rotated) photo, so it works in screen space. It goes back to
  // 1 whenever the photo changes. The app turns the system bars black and hides its floating
  // button while the viewer is up (bridge.viewer).
  var VIEWER = '.image-show-modal';
  var VIEWER_CANVAS = '.image-show-modal .photo-player-container';
  var VIEWER_PHOTO = '#imageShowMainImage';
  var ZOOM_MAX = 5;
  var ZOOM_DOUBLE_TAP = 2.5;
  var DOUBLE_TAP_MS = 300;
  var DOUBLE_TAP_PX = 40;
  var TAP_MAX_MS = 400; // held longer, a touch is not a tap
  var PAGE_AT = 0.25; // of the width: a sideways swipe let go further shows the next photo
  var PAGE_FLING_PX_MS = 0.4;
  var CLOSE_AT_PX = 120;
  var CLOSE_FLING_PX_MS = 0.5;
  var CLOSE_FADE_PX = 300; // a swipe down this long fades the viewer out completely
  var VIEWER_SETTLE_MS = 220; // .zw-viewer-settle in zalo-mobile.css
  var PAGE_WAIT_MS = 700;
  var viewerZoom = { canvas: null, photoId: null, s: 1, x: 0, y: 0 };
  var viewerTouch = null;
  var viewerBusy = false; // a page turn or a close is playing
  var lastViewerTap = null;

  function viewerOpen() {
    var modal = document.querySelector(VIEWER);
    return !!modal && !modal.classList.contains('fadeOut');
  }

  // The skin's viewer is on screen or gone: the app's system bars and floating button follow.
  window.__zwReportViewer = function (force) {
    var open = root.classList.contains('zw-skin') && viewerOpen();
    if (!open) root.classList.remove('zw-viewer-bare');
    if (open === window.__zwViewerShown && !force) return;
    window.__zwViewerShown = open;
    try { bridge.viewer(open); } catch (e) { /* older app or not running inside it */ }
  };
  window.__zwReportViewer(true);

  // The canvas and the photo on screen; a new photo (or a new viewer) starts unzoomed.
  function viewerParts() {
    var canvas = document.querySelector(VIEWER_CANVAS);
    var photo = canvas && canvas.querySelector(VIEWER_PHOTO);
    if (!photo) return null;
    var img = photo.querySelector('img');
    var id = img ? img.id : '';
    if (canvas !== viewerZoom.canvas || id !== viewerZoom.photoId) {
      viewerZoom = { canvas: canvas, photoId: id, s: 1, x: 0, y: 0 };
      placeCanvas(canvas, viewerZoom, false);
    }
    return { canvas: canvas, photo: photo };
  }

  // With transform-origin 0 0: a canvas point p shows at (x, y) + s * p.
  function placeCanvas(canvas, z, settle) {
    canvas.classList.toggle('zw-viewer-settle', !!settle);
    canvas.style.transform = z.s === 1 && z.x === 0 && z.y === 0 ? ''
      : 'translate3d(' + z.x + 'px,' + z.y + 'px,0) scale(' + z.s + ')';
  }

  // The viewer's room and the photo's box unzoomed, both relative to the canvas.
  function viewerLayout(parts) {
    var area = parts.canvas.parentElement.getBoundingClientRect(); // the canvas fills it, untransformed
    var r = parts.photo.getBoundingClientRect();
    var z = viewerZoom;
    return {
      area: area,
      left: (r.left - area.left - z.x) / z.s,
      top: (r.top - area.top - z.y) / z.s,
      width: r.width / z.s,
      height: r.height / z.s
    };
  }

  // Zoom to s keeping the photo point under the screen point (px, py) where it is.
  function zoomAround(from, s, px, py, layout) {
    var lx = (px - layout.area.left - from.x) / from.s;
    var ly = (py - layout.area.top - from.y) / from.s;
    return { s: s, x: px - layout.area.left - s * lx, y: py - layout.area.top - s * ly };
  }

  // A photo larger than the room covers it (no black edge shows); a smaller one stays centred.
  function clampZoom(z, layout) {
    var s = Math.min(ZOOM_MAX, Math.max(1, z.s));
    if (s === 1) return { s: 1, x: 0, y: 0 }; // where Zalo centres it
    function axis(offset, start, size, room) {
      var len = size * s;
      if (len <= room) return (room - len) / 2 - start * s;
      return Math.min(-start * s, Math.max(room - (start + size) * s, offset));
    }
    return {
      s: s,
      x: axis(z.x, layout.left, layout.width, layout.area.width),
      y: axis(z.y, layout.top, layout.height, layout.area.height)
    };
  }

  function setZoom(parts, z, settle) {
    viewerZoom.s = z.s;
    viewerZoom.x = z.x;
    viewerZoom.y = z.y;
    placeCanvas(parts.canvas, z, settle);
  }

  // 1 = the viewer as usual, 0 = gone (the chat shows through), while a swipe down drags it.
  function fadeViewer(level, settle) {
    var viewer = document.querySelector(VIEWER + ' .media-viewer');
    if (!viewer) return;
    viewer.classList.toggle('zw-viewer-settle', !!settle);
    if (level >= 1) viewer.style.removeProperty('background-color');
    else viewer.style.setProperty('background-color', 'rgba(0,0,0,' + level.toFixed(3) + ')', 'important');
    Array.prototype.forEach.call(viewer.querySelectorAll('.media-viewer__header, .media-viewer__footer'), function (bar) {
      bar.style.transition = settle ? '' : 'none';
      bar.style.opacity = level >= 1 ? '' : String(level);
    });
  }

  function onViewerTap(parts, ev) {
    var last = lastViewerTap;
    if (last && ev.timeStamp - last.at < DOUBLE_TAP_MS &&
        Math.abs(ev.clientX - last.x) < DOUBLE_TAP_PX && Math.abs(ev.clientY - last.y) < DOUBLE_TAP_PX) {
      clearTimeout(last.timer);
      lastViewerTap = null;
      var layout = viewerLayout(parts);
      var z = viewerZoom.s > 1 ? { s: 1, x: 0, y: 0 }
        : clampZoom(zoomAround(viewerZoom, ZOOM_DOUBLE_TAP, ev.clientX, ev.clientY, layout), layout);
      setZoom(parts, z, true);
      return;
    }
    lastViewerTap = {
      at: ev.timeStamp, x: ev.clientX, y: ev.clientY,
      timer: setTimeout(function () {
        lastViewerTap = null;
        if (viewerOpen()) root.classList.toggle('zw-viewer-bare');
      }, DOUBLE_TAP_MS)
    };
  }

  // Zalo's ↓ (step 1, the newer photo) or ↑ button. The photo leaves on the side it was swiped
  // to, then the next one comes in from the other side; with no next photo, it comes back.
  function turnPage(parts, step, width) {
    var btn = document.querySelector(VIEWER + ' .navBtn.fa-Chevron_' + (step > 0 ? 'Down' : 'Up') + '_24_Line');
    if (!btn) {
      setZoom(parts, { s: 1, x: 0, y: 0 }, true);
      return;
    }
    viewerBusy = true;
    var from = viewerZoom.photoId;
    setZoom(parts, { s: 1, x: -step * width, y: 0 }, true);
    setTimeout(function () {
      tap(btn);
      var since = Date.now();
      (function waitForPhoto() {
        var canvas = document.querySelector(VIEWER_CANVAS);
        var img = canvas && canvas.querySelector(VIEWER_PHOTO + ' img');
        var turned = !!img && img.id !== from;
        if (canvas && !turned && Date.now() - since < PAGE_WAIT_MS) {
          requestAnimationFrame(waitForPhoto);
          return;
        }
        viewerBusy = false;
        if (!canvas) return;
        viewerZoom = { canvas: canvas, photoId: img ? img.id : '', s: 1, x: 0, y: 0 };
        if (turned) {
          placeCanvas(canvas, { s: 1, x: step * width, y: 0 }, false);
          getComputedStyle(canvas).transform; // start the slide in from there
        }
        placeCanvas(canvas, viewerZoom, true);
      })();
    }, VIEWER_SETTLE_MS);
  }

  // A swipe down let go: the photo carries on out of sight as the viewer fades, then Zalo closes it.
  function closeViewer(parts, x, height) {
    viewerBusy = true;
    setZoom(parts, { s: 1, x: x, y: height }, true);
    fadeViewer(0, true);
    setTimeout(function () {
      viewerBusy = false;
      var close = document.getElementById('image-show__close');
      if (close && viewerOpen()) tap(close); else if (viewerOpen()) pressEscape();
    }, VIEWER_SETTLE_MS);
  }

  function endViewerTouch(act, ev) {
    var t = viewerTouch;
    if (!t) return;
    viewerTouch = null;
    var parts = t.parts;
    if (!parts.canvas.isConnected) return;
    if (t.kind === 'pinch' || t.kind === 'pan') {
      setZoom(parts, clampZoom(viewerZoom, viewerLayout(parts)), true);
      return;
    }
    var still = !ev || ev.timeStamp - t.lastAt > BACK_STILL_MS;
    var vx = act && !still ? t.vx : 0;
    var vy = act && !still ? t.vy : 0;
    if (t.kind === 'page') {
      var width = t.layout.area.width;
      var dx = viewerZoom.x;
      if (act && (dx < -width * PAGE_AT || vx < -PAGE_FLING_PX_MS)) turnPage(parts, 1, width);
      else if (act && (dx > width * PAGE_AT || vx > PAGE_FLING_PX_MS)) turnPage(parts, -1, width);
      else setZoom(parts, { s: 1, x: 0, y: 0 }, true);
      return;
    }
    if (t.kind === 'close') {
      if (act && (viewerZoom.y > CLOSE_AT_PX || vy > CLOSE_FLING_PX_MS)) {
        closeViewer(parts, viewerZoom.x, t.layout.area.height);
      } else {
        setZoom(parts, { s: 1, x: 0, y: 0 }, true);
        fadeViewer(1, true);
      }
      return;
    }
    if (!t.kind && act && ev && ev.timeStamp - t.downAt < TAP_MAX_MS) onViewerTap(parts, ev);
  }

  // A second finger landed: whatever the first one was doing becomes a pinch.
  function startPinch(t) {
    var ids = Object.keys(t.points);
    var a = t.points[ids[0]];
    var b = t.points[ids[1]];
    if (t.kind === 'page' || t.kind === 'close') {
      fadeViewer(1, false);
      setZoom(t.parts, { s: 1, x: 0, y: 0 }, false);
    }
    t.kind = 'pinch';
    t.ids = ids;
    t.from = { s: viewerZoom.s, x: viewerZoom.x, y: viewerZoom.y };
    t.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    t.dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    t.layout = viewerLayout(t.parts);
  }

  var viewerHandlers = {};

  viewerHandlers.pointerdown = function (ev) {
    if (ev.pointerType !== 'touch') return;
    var t = viewerTouch;
    if (t && t.points[ev.pointerId] === undefined && Object.keys(t.points).length === 1 && t.kind !== 'pinch') {
      t.points[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      startPinch(t);
      return;
    }
    if (t) return; // a third finger
    if (viewerBusy || !root.classList.contains('zw-skin') || !ev.target.closest || !ev.target.closest(VIEWER_CANVAS)) return;
    var parts = viewerParts();
    if (!parts) return;
    var points = {};
    points[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    viewerTouch = {
      parts: parts, points: points, kind: null, x: ev.clientX, y: ev.clientY,
      from: { s: viewerZoom.s, x: viewerZoom.x, y: viewerZoom.y }, layout: viewerLayout(parts),
      downAt: ev.timeStamp, lastX: ev.clientX, lastY: ev.clientY, lastAt: ev.timeStamp, vx: 0, vy: 0
    };
  };

  viewerHandlers.pointermove = function (ev) {
    var t = viewerTouch;
    if (!t || !t.points[ev.pointerId]) return;
    t.points[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    if (t.kind === 'pinch') {
      var a = t.points[t.ids[0]];
      var b = t.points[t.ids[1]];
      if (!a || !b) return;
      var s = Math.min(ZOOM_MAX, Math.max(0.8, t.from.s * Math.hypot(a.x - b.x, a.y - b.y) / t.dist));
      var z = zoomAround(t.from, s, t.mid.x, t.mid.y, t.layout);
      // The midpoint moving drags the photo along.
      z.x += (a.x + b.x) / 2 - t.mid.x;
      z.y += (a.y + b.y) / 2 - t.mid.y;
      setZoom(t.parts, z, false);
      return;
    }
    var dx = ev.clientX - t.x;
    var dy = ev.clientY - t.y;
    if (!t.kind) {
      if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
      t.kind = t.from.s > 1 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'page' : dy > 0 ? 'close' : 'none';
      // Count from here, so nothing jumps by the slop.
      t.x = ev.clientX;
      t.y = ev.clientY;
      dx = 0;
      dy = 0;
    }
    var dt = ev.timeStamp - t.lastAt;
    if (dt > 0) {
      t.vx = 0.6 * (ev.clientX - t.lastX) / dt + 0.4 * t.vx;
      t.vy = 0.6 * (ev.clientY - t.lastY) / dt + 0.4 * t.vy;
      t.lastX = ev.clientX;
      t.lastY = ev.clientY;
      t.lastAt = ev.timeStamp;
    }
    if (t.kind === 'pan') {
      setZoom(t.parts, clampZoom({ s: t.from.s, x: t.from.x + dx, y: t.from.y + dy }, t.layout), false);
    } else if (t.kind === 'page') {
      setZoom(t.parts, { s: 1, x: dx, y: 0 }, false);
    } else if (t.kind === 'close') {
      setZoom(t.parts, { s: 1, x: dx, y: Math.max(0, dy) }, false);
      fadeViewer(1 - Math.min(1, Math.max(0, dy) / CLOSE_FADE_PX), false);
    }
  };

  // A pinch ends with its first finger up; the other one does nothing more until it lifts.
  viewerHandlers.pointerup = function (ev) {
    if (viewerTouch && viewerTouch.points[ev.pointerId]) endViewerTouch(true, ev);
  };

  viewerHandlers.pointercancel = function (ev) {
    if (viewerTouch && viewerTouch.points[ev.pointerId]) endViewerTouch(false, ev);
  };

  // Zalo closes the viewer on a click on the photo: the photo's taps are ours.
  viewerHandlers.click = function (ev) {
    if (root.classList.contains('zw-skin') && ev.target.closest && ev.target.closest(VIEWER_CANVAS)) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  };

  // Replaced on every injection, like the swipe handlers above.
  if (window.__zwEndViewerGesture) window.__zwEndViewerGesture();
  window.__zwEndViewerGesture = function () { endViewerTouch(false); };
  var oldViewerHandlers = window.__zwViewerHandlers || {};
  Object.keys(oldViewerHandlers).forEach(function (type) {
    document.removeEventListener(type, oldViewerHandlers[type], true);
  });
  window.__zwViewerHandlers = viewerHandlers;
  Object.keys(viewerHandlers).forEach(function (type) {
    document.addEventListener(type, viewerHandlers[type], true);
  });

  // ---------------------------------------------------------------- Keyboard (MainActivity.KeyboardAnimation)

  // The chat (Zalo's #chatView: messages + composer) slides with the keyboard, on the compositor,
  // with the curve and duration Android gives the keyboard (InsetsController's synced IME
  // animation). Opening: the WebView keeps its full height until the keyboard is up, so the chat
  // slides up, then the WebView shrinks and the slide is dropped in that resize. Closing: the
  // WebView grows at once, so the chat starts where it was and slides down. html.zw-keyboard keeps
  // the header above the sliding chat.
  var KEYBOARD_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  var KEYBOARD_MS = 285;
  var KEYBOARD_MIN_PX = 100; // smaller size changes are the keyboard's own (suggestion strip etc.)
  var KEYBOARD_SAFETY_MS = 700; // opened but the WebView never shrank: drop the slide anyway
  var KEYBOARD_CATCH_UP_MIN_MS = 150;

  function chatToSlide() {
    return root.classList.contains('zw-skin') ? document.getElementById('chatView') : null;
  }

  function unslideChat(view) {
    clearTimeout(window.__zwKeyboardTimer);
    if (view.__zwKeyboardSlide) view.__zwKeyboardSlide.cancel();
    view.__zwKeyboardSlide = null;
    view.__zwKeyboardLifting = false;
    root.classList.remove('zw-keyboard');
  }

  // Where the slide has the chat right now (px, negative = up).
  function slideOffset(view) {
    var m = /matrix\(1, 0, 0, 1, 0, (-?[\d.e-]+)\)/.exec(getComputedStyle(view).transform);
    return m ? parseFloat(m[1]) : 0;
  }

  function slideChat(view, from, to, ms, elapsed) {
    unslideChat(view);
    root.classList.add('zw-keyboard');
    view.__zwKeyboardSlide = view.animate(
      [{ transform: 'translateY(' + from + 'px)' }, { transform: 'translateY(' + to + 'px)' }],
      { duration: ms, delay: -elapsed, easing: KEYBOARD_EASE, fill: 'forwards' }
    );
    view.__zwKeyboardLifting = to < 0; // opening: up to the keyboard until the WebView shrinks
    window.__zwKeyboardTimer = setTimeout(function () { unslideChat(view); },
      ms - elapsed + (to ? KEYBOARD_SAFETY_MS : 0));
  }

  function sinceStart(rec) {
    return Math.max(0, Math.min(rec.ms, Date.now() - rec.startedAt));
  }

  // Called by the app as the keyboard starts moving; liftPx is its height above the navigation bar
  // in screen pixels, viewPx the WebView's height in screen pixels.
  window.__zwKeyboard = function (opening, liftPx, ms, startedAt, viewPx) {
    var rec = { ms: ms, startedAt: startedAt };
    var view = chatToSlide();
    if (opening) {
      // Reopened while still sliding down: carry on from where the chat is.
      var from = view && view.__zwKeyboardSlide ? slideOffset(view) : 0;
      // CSS px per screen pixel also follows the page scale (a fixed Độ rộng hiển thị, pinch zoom).
      var cssPerPx = viewPx > 0 ? innerHeight / viewPx : 1 / devicePixelRatio;
      if (view) slideChat(view, from, -liftPx * cssPerPx, ms, sinceStart(rec));
      return;
    }
    if (view && view.__zwKeyboardLifting) {
      // Closed before the WebView shrank (Back right as it opened): no resize will come, so slide
      // down from where the chat is now.
      window.__zwKeyboardClosing = null;
      slideChat(view, slideOffset(view), 0, Math.max(KEYBOARD_CATCH_UP_MIN_MS, ms - sinceStart(rec)), 0);
      return;
    }
    // Otherwise the resize that starts the slide down comes just before or after this call.
    window.__zwKeyboardClosing = rec;
  };

  if (window.__zwKeyboardResize) window.removeEventListener('resize', window.__zwKeyboardResize);
  window.__zwKeyboardSize = window.__zwKeyboardSize || { width: innerWidth, height: innerHeight };
  window.__zwKeyboardResize = function () {
    var last = window.__zwKeyboardSize;
    var grew = innerHeight - last.height;
    var sameWidth = innerWidth === last.width;
    window.__zwKeyboardSize = { width: innerWidth, height: innerHeight };
    var view = chatToSlide();
    if (!view || !sameWidth) return;
    if (grew < -KEYBOARD_MIN_PX) {
      unslideChat(view); // keyboard up: the layout lifts the chat now
    } else if (grew > KEYBOARD_MIN_PX) {
      // The keyboard has been going down for a while by now (the WebView takes ~50 ms to lay out at
      // the new size). Jumping to where it is reads as a jerk; start from where the chat is and
      // catch up over the rest of the animation instead.
      var closing = window.__zwKeyboardClosing;
      window.__zwKeyboardClosing = null;
      if (closing && Date.now() - closing.startedAt > closing.ms) closing = null; // a stale one
      var rest = closing ? closing.ms - sinceStart(closing) : KEYBOARD_MS;
      slideChat(view, -grew, 0, Math.max(KEYBOARD_CATCH_UP_MIN_MS, rest), 0);
    }
  };
  window.addEventListener('resize', window.__zwKeyboardResize);

  // ---------------------------------------------------------------- Keep typing after Send

  // A tap on a composer button while typing (Gửi, the quick 👍, formatting) keeps the focus, and
  // so the keyboard, in the message box, as in the phone app. By default the tap moves the focus
  // to the chat and the keyboard closes. The emoji button still lets go, so its panel takes the
  // keyboard's place. On window, capture phase; replaced on every injection.
  if (window.__zwKeepFocus) window.removeEventListener('mousedown', window.__zwKeepFocus, true);
  window.__zwKeepFocus = function (ev) {
    var row = document.getElementById('chat-input-container-id');
    var btn = ev.target && ev.target.closest && ev.target.closest('#chat-input-container-id .z--btn--v2');
    var field = editableOf(document.activeElement);
    if (!btn || !field || !row.contains(field) || btn.querySelector('.fa-Emoji_24_Line')) return;
    ev.preventDefault();
  };
  window.addEventListener('mousedown', window.__zwKeepFocus, true);

  // Sending (Gửi or Enter) makes Zalo take the message box out and focus a new one ~25 ms later.
  // With nothing focused in between, Android starts closing the keyboard and opens it again: it
  // dips. When the box loses the focus to nothing right after the composer was used (a tap or a
  // key) while the keyboard is open (__zwKeyboardOpen, kept by the app), a hidden stand-in field
  // holds the focus, and the keyboard, until Zalo focuses the new box (or KEEPER_MS passes). With
  // the keyboard closed it stays closed, and a chat being closed lets it go at once.
  var KEEPER_MS = 400;
  var COMPOSER_USE_MS = 1000;

  function keyboardKeeper() {
    var keeper = document.getElementById('zw-keyboard-keeper');
    if (!keeper) {
      keeper = document.createElement('textarea');
      keeper.id = 'zw-keyboard-keeper';
      keeper.tabIndex = -1;
      keeper.setAttribute('aria-hidden', 'true');
      keeper.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;padding:0;' +
        'border:0;opacity:0;pointer-events:none;resize:none';
      document.body.appendChild(keeper);
    }
    return keeper;
  }

  // window.__zwComposerUsedAt: last tap or key in the composer (a tap elsewhere clears it); the
  // "no surprise keyboard" guard below reads it too.
  function inComposer(el) {
    return !!(el && el.closest && el.closest('#chat-box-input-container-id'));
  }
  if (window.__zwComposerTap) window.removeEventListener('pointerdown', window.__zwComposerTap, true);
  window.__zwComposerTap = function (ev) {
    window.__zwComposerUsedAt = inComposer(ev.target) ? Date.now() : 0;
  };
  window.addEventListener('pointerdown', window.__zwComposerTap, true);
  if (window.__zwComposerKey) window.removeEventListener('keydown', window.__zwComposerKey, true);
  window.__zwComposerKey = function (ev) {
    if (inComposer(ev.target)) window.__zwComposerUsedAt = Date.now();
  };
  window.addEventListener('keydown', window.__zwComposerKey, true);

  if (window.__zwHoldKeyboard) document.removeEventListener('focusout', window.__zwHoldKeyboard, true);
  window.__zwHoldKeyboard = function (ev) {
    var row = document.getElementById('chat-box-input-container-id');
    var now = Date.now();
    if (ev.relatedTarget || !row || !row.contains(ev.target) || !editableOf(ev.target) ||
        !root.classList.contains('zw-skin') || !window.__zwKeyboardOpen ||
        now - (window.__zwComposerUsedAt || 0) > COMPOSER_USE_MS ||
        now - (window.__zwClosingChatAt || 0) < COMPOSER_USE_MS) return;
    var keeper = keyboardKeeper();
    keeper.value = ''; // a key typed into it meanwhile goes nowhere; don't let them pile up
    window.__zwFocusAllowedUntil = Date.now() + KEEPER_MS; // past the "no surprise keyboard" guard
    keeper.focus({ preventScroll: true });
    setTimeout(function () {
      if (document.activeElement === keeper) keeper.blur();
      keeper.value = '';
    }, KEEPER_MS);
  };
  document.addEventListener('focusout', window.__zwHoldKeyboard, true);

  // ---------------------------------------------------------------- Hooks below install once per page

  if (window.__zwHooked) return;
  window.__zwHooked = true;

  // ---------------------------------------------------------------- No surprise keyboard

  // Zalo focuses the message box whenever a chat opens; on a phone that pops the keyboard.
  // Only allow focusing a text field when:
  //  - the user just touched it or right next to it (Zalo's editor only turns contenteditable on
  //    while focused, so the touch lands on a child or sibling),
  //  - it is the message box, the composer was just used (a tap or a key) and the keyboard is open
  //    (Zalo putting the focus on a new box after Gửi or Enter),
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

  // Up to <body> only: a tap on something just under it (the tab bar, the opening placeholder)
  // would otherwise count as "next to" every field on the page.
  function touchedNear(field) {
    if (!lastDown || Date.now() - lastDownAt > FOCUS_GRACE_MS) return false;
    for (var n = lastDown, i = 0; n && n !== document.body && i <= NEAR_LEVELS; n = n.parentElement, i++) {
      if (n.contains(field)) return true;
    }
    return false;
  }

  function composerJustUsed(field) {
    var composer = document.getElementById('chat-box-input-container-id');
    return !!window.__zwKeyboardOpen && !!composer && composer.contains(field) &&
      Date.now() - (window.__zwComposerUsedAt || 0) < FOCUS_GRACE_MS;
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
    if (returning || touchedNear(field) || composerJustUsed(field) ||
        Date.now() < (window.__zwFocusAllowedUntil || 0) ||
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
    if (window.__zwDropSwipe) window.__zwDropSwipe();
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
