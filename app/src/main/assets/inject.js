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
        if (tab) tab.click();
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

  // Instant chat opening. Zalo spends 0.5-0.9 s of its own JS before a tapped chat shows up, with
  // nothing on screen reacting meanwhile. With the skin on, tapping a conversation slides in a
  // placeholder right away (blue header with the chat's avatar and name); it fades out as soon as
  // Zalo's chat view is mounted, or after OPENING_MAX_MS if the tap didn't open anything.
  var OPENING_MAX_MS = 2500;

  window.__zwHideOpening = function () {
    var el = document.getElementById('zw-opening');
    if (!el || el.classList.contains('zw-opening--done')) return;
    el.classList.add('zw-opening--done');
    setTimeout(function () { el.remove(); }, 150);
  };

  window.__zwSyncOpening = function () {
    var el = document.getElementById('zw-opening');
    if (!el) return;
    if (document.querySelector('.conv-back-btn') || Date.now() - el.__zwShownAt > OPENING_MAX_MS) {
      window.__zwHideOpening();
    }
  };

  // Mirrors Zalo's chat header (back icon, title, empty subtitle line) so the swap is seamless.
  function showOpening(item) {
    var old = document.getElementById('zw-opening');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'zw-opening';
    el.__zwShownAt = Date.now();
    var header = document.createElement('div');
    header.className = 'zw-opening__header';
    var back = document.createElement('i');
    back.className = 'fa fa-icon-solid-left zw-opening__back';
    header.appendChild(back);
    var titles = document.createElement('div');
    titles.className = 'zw-opening__titles';
    var name = document.createElement('div');
    name.className = 'zw-opening__name';
    var title = item.querySelector('.conv-item-title__name');
    name.textContent = title ? title.textContent.trim() : '';
    titles.appendChild(name);
    var sub = document.createElement('div');
    sub.className = 'zw-opening__sub';
    titles.appendChild(sub);
    header.appendChild(titles);
    el.appendChild(header);
    var body = document.createElement('div');
    body.className = 'zw-opening__body';
    el.appendChild(body);
    var composer = document.createElement('div');
    composer.className = 'zw-opening__composer';
    el.appendChild(composer);
    document.body.appendChild(el);
    // Check every frame until Zalo's chat view is up (or the timeout passes).
    (function poll() {
      if (!document.getElementById('zw-opening')) return;
      window.__zwSyncOpening();
      requestAnimationFrame(poll);
    })();
  }

  if (!window.__zwOpeningInstalled) {
    window.__zwOpeningInstalled = true;
    document.addEventListener('click', function (ev) {
      if (!root.classList.contains('zw-skin') || document.querySelector('.conv-back-btn')) return;
      var target = ev.target;
      if (!target || !target.closest) return;
      var item = target.closest('#conversationListId .conv-item');
      // The row's own "…" button opens a menu, not the chat.
      if (!item || target.closest('.z--btn--v2')) return;
      showOpening(item);
    }, true);
  }

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

  // Returns true when something inside Zalo was closed.
  window.__zwBack = function () {
    // A chat is still opening behind the placeholder: cancel the placeholder, stay in the app.
    if (document.getElementById('zw-opening') && !document.querySelector('.conv-back-btn')) {
      if (window.__zwHideOpening) window.__zwHideOpening();
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
        convBack.click();
      }
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- Hooks below install once per page

  if (window.__zwHooked) return;
  window.__zwHooked = true;

  // ---------------------------------------------------------------- No surprise keyboard

  // Zalo focuses the message box whenever a chat opens; on a phone that pops the keyboard.
  // Only allow focusing a text field when:
  //  - the user just touched it or right next to it (Zalo's editor only turns contenteditable on
  //    while focused, so the touch lands on a child or sibling),
  //  - it is the same field that lost focus a moment ago (Zalo restoring focus after Send), or
  //  - the browser is giving focus back to it after the app/window was away (dialogs, app switch).
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
    if (returning || touchedNear(field) ||
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
