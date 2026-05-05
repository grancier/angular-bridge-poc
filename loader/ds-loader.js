(function () {
  'use strict';

  var state = {
    mounted: false,
    mode: null,
    root: null,
    script: null
  };

  function getQueryMode() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get('bridgeMode') || params.get('dsMode');
    } catch (e) {
      return null;
    }
  }

  function normalizeMode(mode) {
    return mode === 'custom-event' ? 'custom-event' : 'iframe';
  }

  function resolveRoot(config) {
    var root = config.root || 'ds-canvas-host';
    if (typeof root !== 'string') return root;

    var found = document.querySelector(root);
    if (found) return found;

    if (root.charAt(0) === '#' || root.charAt(0) === '.') {
      throw new Error('Canvas root not found: ' + root);
    }

    var created = document.createElement(root);
    document.body.appendChild(created);
    return created;
  }

  function resolveBundleUrl(config, mode) {
    if (config.bundleUrl) return config.bundleUrl;
    if (config.bundles && config.bundles[mode]) return config.bundles[mode];
    throw new Error('Missing bundle URL for mode: ' + mode);
  }

  function loadModule(src, mode) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.type = 'module';
      script.async = true;
      script.src = src;
      script.dataset.dsCanvasMode = mode;
      script.onload = function () { resolve(script); };
      script.onerror = function () { reject(new Error('Failed to load DesignSpace bundle: ' + src)); };
      document.head.appendChild(script);
      state.script = script;
    });
  }

  function mountCanvas(config) {
    config = config || {};
    if (state.mounted) return Promise.resolve(window.__sfcc);

    var mode = normalizeMode(config.mode || getQueryMode());
    var root = resolveRoot(config);
    var bundleUrl = resolveBundleUrl(config, mode);

    state.mode = mode;
    state.root = root;
    root.setAttribute('data-ds-runtime-mode', mode);

    return loadModule(bundleUrl, mode).then(function () {
      state.mounted = true;
      return window.__sfcc;
    });
  }

  function unmountCanvas() {
    if (state.root) {
      state.root.removeAttribute('data-ds-runtime-mode');
      state.root.textContent = '';
    }
    state.mounted = false;
    state.mode = null;
  }

  window.__sfcc = window.__sfcc || {};
  window.__sfcc.mountCanvas = mountCanvas;
  window.__sfcc.unmountCanvas = unmountCanvas;
  window.__sfcc.isCanvasMounted = function () { return state.mounted; };
  window.__sfcc.getCanvasMode = function () { return state.mode; };
})();