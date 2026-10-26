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
  // popup/modal/viewer (Escape) -> conversation info panel -> conversation -> let Android decide.
  var backTries = new WeakMap();
  // Closing a chat animates for ~0.9s with the back button still mounted; swallow repeats meanwhile.
  var CHAT_CLOSE_MS = 1500;
  var lastChatClose = 0;

  function isShown(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  // Zalo renders popovers, modals and the media viewer as direct children of <body>.
  function topOverlay() {
    var kids = document.body ? document.body.children : [];
    for (var i = kids.length - 1; i >= 0; i--) {
      var el = kids[i];
      if (el.id === 'app' || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      if (isShown(el)) return el;
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
    var overlay = topOverlay();
    if (overlay) {
      var tries = backTries.get(overlay) || 0;
      if (tries < 2) {
        backTries.set(overlay, tries + 1);
        var close = tries > 0 && overlay.querySelector('.modal-header-icon, [class*="close"]');
        if (close) close.click(); else pressEscape();
        return true;
      }
      // Ignores both Escape and its close button (e.g. a toast): fall through.
    }
    var infoToggle = document.querySelector('#header .fa-outline-right-bar-active');
    if (isShown(infoToggle)) {
      (infoToggle.closest('.z--btn--v2') || infoToggle).click();
      return true;
    }
    var convBack = document.querySelector('.conv-back-btn');
    if (isShown(convBack)) {
      var now = Date.now();
      if (now - lastChatClose > CHAT_CLOSE_MS) {
        lastChatClose = now;
        convBack.click();
      }
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- Download hooks (once per page)

  if (window.__zwHooked) return;
  window.__zwHooked = true;

  var MAX_BLOBS = 40;
  // Zalo revokes blob URLs right after clicking, so keep the original Blob around ourselves.
  var blobs = new Map();

  var origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var url = origCreateObjectURL.apply(this, arguments);
    try {
      if (obj instanceof Blob) {
        blobs.set(url, obj);
        while (blobs.size > MAX_BLOBS) blobs.delete(blobs.keys().next().value);
      }
    } catch (e) { /* never break the page */ }
    return url;
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

  function saveBlob(blob, name, mime) {
    var fileName = name || (typeof File !== 'undefined' && blob instanceof File ? blob.name : '');
    return blobToBase64(blob).then(function (b64) {
      bridge.saveBase64(b64, fileName || '', mime || blob.type || '');
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
