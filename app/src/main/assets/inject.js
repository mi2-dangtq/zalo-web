// Injected by MainActivity.injectAll() after every page load and settings change.
// window.__zwConfig = { viewport: <px, 0 = auto>, css: <base css>, customCss: <user css> }
(function () {
  'use strict';
  var cfg = window.__zwConfig || {};
  var head = document.head || document.documentElement;

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
  setStyle('zw-custom', cfg.customCss || '');

  // ---------------------------------------------------------------- Viewport

  var width = parseInt(cfg.viewport, 10) || 0;
  var meta = document.querySelector('meta[name="viewport"]');
  if (width > 0) {
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      head.appendChild(meta);
    }
    var content = 'width=' + width + ', user-scalable=yes';
    if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
    meta.setAttribute('data-zw', '1');
  } else if (meta && meta.getAttribute('data-zw') === '1') {
    meta.parentNode.removeChild(meta);
  }

  // ---------------------------------------------------------------- Download hooks (once per page)

  if (window.__zwHooked) return;
  window.__zwHooked = true;

  var bridge = window.AndroidBridge;
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
