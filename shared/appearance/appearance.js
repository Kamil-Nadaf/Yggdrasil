/* Yggdrasil shared Appearance panel — vanilla JS, no dependencies. */
(function (global) {
  "use strict";

  var STORAGE_KEY = "app-appearance";
  var THEME_IDS = ["paper", "dark", "observatory", "manuscript"];
  var SIZES = { small: 13, medium: 15, large: 17 };
  var ACCENTS = [
    { id: "orange", hex: "#c97b4a", label: "Orange" },
    { id: "blue", hex: "#3b82f6", label: "Blue" },
    { id: "teal", hex: "#14b8a6", label: "Teal" },
    { id: "green", hex: "#22c55e", label: "Green" },
    { id: "slate", hex: "#64748b", label: "Slate" },
    { id: "purple", hex: "#8b5cf6", label: "Purple" },
    { id: "rose", hex: "#f43f5e", label: "Rose" },
  ];

  var THEMES = {
    paper: {
      id: "paper",
      label: "Paper",
      bg: "#f5f0eb",
      surface: "#fffaf6",
      border: "#e4d8cc",
      text: "#1c1917",
      muted: "#7a7068",
      accent: "#c97b4a",
      accentForeground: "#fffaf6",
      ok: "#3f7a4c",
      warn: "#b45309",
      crit: "#b42318",
      fontSans: "Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif",
      fontMono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
      labelTransform: "none",
      labelTracking: "0.02em",
      radius: "12px",
    },
    dark: {
      id: "dark",
      label: "Dark",
      bg: "#141414",
      surface: "#1c1c1c",
      border: "#2a2a2a",
      text: "#f3f3f3",
      muted: "#9a9a9a",
      accent: "#3b82f6",
      accentForeground: "#141414",
      ok: "#34d399",
      warn: "#f59e0b",
      crit: "#f87171",
      fontSans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontMono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
      labelTransform: "none",
      labelTracking: "0.02em",
      radius: "10px",
    },
    observatory: {
      id: "observatory",
      label: "Observatory",
      bg: "#f0f0e8",
      surface: "#e8e8dc",
      border: "#1a1a1a",
      text: "#141414",
      muted: "#5a5a52",
      accent: "#1a1a1a",
      accentForeground: "#f0f0e8",
      ok: "#1a1a1a",
      warn: "#1a1a1a",
      crit: "#1a1a1a",
      fontSans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontMono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
      labelTransform: "uppercase",
      labelTracking: "0.08em",
      radius: "0px",
    },
    manuscript: {
      id: "manuscript",
      label: "Manuscript",
      bg: "#fdf6e3",
      surface: "#fff8e8",
      border: "#ead9b8",
      text: "#3d2e14",
      muted: "#8a7344",
      accent: "#e8a020",
      accentForeground: "#3d2e14",
      ok: "#6a7a32",
      warn: "#c47b10",
      crit: "#b42318",
      fontSans: "Palatino, 'Palatino Linotype', Georgia, serif",
      fontMono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
      labelTransform: "none",
      labelTracking: "0.04em",
      radius: "8px",
    },
  };

  var state = {
    theme: "paper",
    accent: null,
    textColor: null,
    textSize: "medium",
  };
  var options = {
    trigger: null,
    lockedColors: {},
    storageKey: STORAGE_KEY,
    onBack: null,
  };
  var nodes = { overlay: null, drawer: null };
  var booted = false;

  function storageKey() {
    return options.storageKey || STORAGE_KEY;
  }

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var n = parseInt(h, 16);
    if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(rgb) {
    function byte(v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + byte(rgb.r) + byte(rgb.g) + byte(rgb.b);
  }

  function mix(aHex, bHex, amountB) {
    var a = hexToRgb(aHex);
    var b = hexToRgb(bHex);
    var t = amountB;
    return rgbToHex({
      r: a.r * (1 - t) + b.r * t,
      g: a.g * (1 - t) + b.g * t,
      b: a.b * (1 - t) + b.b * t,
    });
  }

  function relativeLuminance(hex) {
    var rgb = hexToRgb(hex);
    function lin(c) {
      var x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }

  function toHsla(hex, alpha) {
    var rgb = hexToRgb(hex);
    var r = rgb.r / 255;
    var g = rgb.g / 255;
    var b = rgb.b / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return "hsla(" + Math.round(h * 360) + ", " + Math.round(s * 100) + "%, " + Math.round(l * 100) + "%, " + alpha + ")";
  }

  function defaults() {
    return { theme: "paper", accent: null, textColor: null, textSize: "medium" };
  }

  function normalize(raw) {
    var next = defaults();
    if (!raw || typeof raw !== "object") return next;
    if (THEME_IDS.indexOf(raw.theme) !== -1) next.theme = raw.theme;
    if (typeof raw.accent === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.accent)) {
      next.accent = raw.accent;
    }
    if (typeof raw.textColor === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.textColor)) {
      next.textColor = raw.textColor;
    }
    if (raw.textSize && SIZES[raw.textSize]) next.textSize = raw.textSize;
    return next;
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(storageKey()) || "null"));
    } catch (err) {
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify({
          theme: state.theme,
          accent: state.accent,
          textColor: state.textColor,
          textSize: state.textSize,
        })
      );
    } catch (err) {
      /* private mode */
    }
  }

  function applyLocked(root) {
    var locked = options.lockedColors || {};
    Object.keys(locked).forEach(function (key) {
      var safe = String(key).replace(/[^a-z0-9_-]/gi, "");
      if (safe && locked[key]) root.style.setProperty("--locked-" + safe, locked[key]);
    });
  }

  function apply(root) {
    var theme = THEMES[state.theme] || THEMES.paper;
    var accent = state.accent || theme.accent;
    var text = state.textColor || theme.text;
    var size = SIZES[state.textSize] || SIZES.medium;
    var accentFg = relativeLuminance(accent) > 0.62 ? theme.text : theme.bg;
    if (theme.id === "dark") accentFg = relativeLuminance(accent) > 0.62 ? theme.bg : theme.text;

    root.setAttribute("data-appearance", theme.id);
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--surface", theme.surface);
    root.style.setProperty("--border", theme.border);
    root.style.setProperty("--text", text);
    root.style.setProperty("--muted", theme.muted);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", mix(accent, theme.bg, 0.86));
    root.style.setProperty("--accent-foreground", accentFg);
    root.style.setProperty("--focus", toHsla(accent, theme.id === "dark" ? 0.45 : 0.4));
    root.style.setProperty("--ok", theme.ok);
    root.style.setProperty("--warn", theme.warn);
    root.style.setProperty("--crit", theme.crit);
    root.style.setProperty("--font-sans", theme.fontSans);
    root.style.setProperty("--font-mono", theme.fontMono);
    root.style.setProperty("--label-transform", theme.labelTransform);
    root.style.setProperty("--label-tracking", theme.labelTracking);
    root.style.setProperty("--radius", theme.radius);
    root.style.setProperty("--text-size", size + "px");
    applyLocked(root);

    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("appearancechange", { detail: get() }));
    }
    syncPanel();
  }

  function get() {
    return {
      theme: state.theme,
      accent: state.accent,
      textColor: state.textColor,
      textSize: state.textSize,
    };
  }

  function set(partial) {
    state = normalize(Object.assign({}, state, partial || {}));
    save();
    if (typeof document !== "undefined") apply(document.documentElement);
    return get();
  }

  function boot(userOptions) {
    if (userOptions) Object.assign(options, userOptions);
    state = load();
    if (typeof document !== "undefined" && document.documentElement) {
      apply(document.documentElement);
    }
    booted = true;
    return get();
  }

  function accentIsCustom() {
    if (!state.accent) return false;
    return !ACCENTS.some(function (item) {
      return item.hex.toLowerCase() === state.accent.toLowerCase();
    });
  }

  function previewCopy() {
    var theme = THEMES[state.theme] || THEMES.paper;
    var accent = state.accent || theme.accent;
    var named = ACCENTS.find(function (item) {
      return item.hex.toLowerCase() === accent.toLowerCase();
    });
    var size = SIZES[state.textSize] || 15;
    return theme.label + " · " + (named ? named.label : "Custom") + " · " + size + "px";
  }

  function syncPanel() {
    if (!nodes.drawer) return;
    THEME_IDS.forEach(function (id) {
      var btn = nodes.drawer.querySelector('[data-theme="' + id + '"]');
      if (btn) btn.setAttribute("aria-pressed", id === state.theme ? "true" : "false");
    });
    ACCENTS.forEach(function (item) {
      var btn = nodes.drawer.querySelector('[data-accent="' + item.id + '"]');
      if (btn) {
        var on = state.accent && state.accent.toLowerCase() === item.hex.toLowerCase();
        if (!state.accent && item.hex.toLowerCase() === (THEMES[state.theme] || THEMES.paper).accent.toLowerCase()) {
          on = true;
        }
        btn.setAttribute("aria-pressed", on && !accentIsCustom() ? "true" : "false");
      }
    });
    var custom = nodes.drawer.querySelector("[data-accent-custom]");
    if (custom) custom.setAttribute("aria-pressed", accentIsCustom() ? "true" : "false");
    var color = nodes.drawer.querySelector("[data-text-color]");
    var theme = THEMES[state.theme] || THEMES.paper;
    if (color) color.value = state.textColor || theme.text;
    Object.keys(SIZES).forEach(function (id) {
      var btn = nodes.drawer.querySelector('[data-size="' + id + '"]');
      if (btn) btn.setAttribute("aria-pressed", id === state.textSize ? "true" : "false");
    });
    var preview = nodes.drawer.querySelector("[data-preview]");
    if (preview) preview.textContent = previewCopy();
  }

  function buildPanel() {
    if (nodes.drawer) return;
    var overlay = document.createElement("div");
    overlay.className = "ap-overlay";
    overlay.hidden = true;
    overlay.addEventListener("click", close);

    var drawer = document.createElement("aside");
    drawer.className = "ap-drawer";
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Appearance");

    var chips = THEME_IDS.map(function (id) {
      return (
        '<button type="button" class="ap-chip" data-theme="' +
        id +
        '" aria-pressed="false">' +
        THEMES[id].label +
        "</button>"
      );
    }).join("");

    var swatches = ACCENTS.map(function (item) {
      return (
        '<button type="button" class="ap-swatch" data-accent="' +
        item.id +
        '" aria-label="' +
        item.label +
        '" style="--swatch:' +
        item.hex +
        '"></button>'
      );
    }).join("");

    drawer.innerHTML =
      '<div class="ap-header">' +
      '<button type="button" class="ap-ghost" data-back>Back</button>' +
      '<p class="ap-title">Appearance</p>' +
      '<button type="button" class="ap-ghost ap-icon" data-close aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ap-body">' +
      '<section><p class="ap-section-label">Theme</p><div class="ap-chips">' +
      chips +
      "</div></section>" +
      '<section><p class="ap-section-label">Tactile accent</p><div class="ap-swatches">' +
      swatches +
      '<label class="ap-swatch ap-swatch-custom" data-accent-custom aria-label="Custom color">' +
      '<input type="color" value="#c97b4a" data-custom-color>' +
      "</label></div></section>" +
      '<section><p class="ap-section-label">Text color</p><div class="ap-color-row">' +
      '<input type="color" class="ap-color" data-text-color value="#1c1917" aria-label="Text color">' +
      '<button type="button" class="ap-ghost" data-reset-text>Reset</button>' +
      "</div></section>" +
      '<section><p class="ap-section-label">Text size</p><div class="ap-chips">' +
      '<button type="button" class="ap-chip" data-size="small">Small</button>' +
      '<button type="button" class="ap-chip" data-size="medium">Medium</button>' +
      '<button type="button" class="ap-chip" data-size="large">Large</button>' +
      "</div></section>" +
      '<section class="ap-preview"><div class="ap-preview-kicker">Preview as you change</div>' +
      '<div data-preview></div><div class="ap-preview-bar"></div></section>' +
      "</div>";

    drawer.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-theme],[data-accent],[data-size],[data-back],[data-close],[data-reset-text]");
      if (!t) return;
      if (t.hasAttribute("data-back")) {
        if (typeof options.onBack === "function") options.onBack();
        else close();
        return;
      }
      if (t.hasAttribute("data-close")) {
        close();
        return;
      }
      if (t.hasAttribute("data-reset-text")) {
        set({ textColor: null });
        return;
      }
      if (t.hasAttribute("data-theme")) set({ theme: t.getAttribute("data-theme") });
      if (t.hasAttribute("data-size")) set({ textSize: t.getAttribute("data-size") });
      if (t.hasAttribute("data-accent")) {
        var found = ACCENTS.find(function (item) {
          return item.id === t.getAttribute("data-accent");
        });
        if (found) set({ accent: found.hex });
      }
    });

    drawer.querySelector("[data-custom-color]").addEventListener("input", function (ev) {
      set({ accent: ev.target.value });
    });
    drawer.querySelector("[data-text-color]").addEventListener("input", function (ev) {
      set({ textColor: ev.target.value });
    });

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    nodes.overlay = overlay;
    nodes.drawer = drawer;
    syncPanel();
  }

  function onKey(ev) {
    if (ev.key === "Escape") close();
  }

  function open() {
    buildPanel();
    nodes.overlay.hidden = false;
    nodes.drawer.hidden = false;
    document.addEventListener("keydown", onKey);
    var closeBtn = nodes.drawer.querySelector("[data-close]");
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (nodes.overlay) nodes.overlay.hidden = true;
    if (nodes.drawer) nodes.drawer.hidden = true;
    document.removeEventListener("keydown", onKey);
  }

  function init(userOptions) {
    Object.assign(options, userOptions || {});
    if (!booted) boot();
    else apply(document.documentElement);
    function bind() {
      buildPanel();
      if (!options.trigger) return;
      var el = typeof options.trigger === "string" ? document.querySelector(options.trigger) : options.trigger;
      if (el) el.addEventListener("click", open);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
    window.addEventListener("storage", function (ev) {
      if (ev.key === storageKey()) {
        state = load();
        apply(document.documentElement);
      }
    });
    return get();
  }

  boot();

  global.AppearancePanel = {
    boot: boot,
    init: init,
    get: get,
    set: set,
    open: open,
    close: close,
    themes: THEMES,
  };
})(typeof window !== "undefined" ? window : this);
