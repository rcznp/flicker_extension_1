// =====================================================
// CONFIG
// =====================================================
let FLICKER_HZ   = 40;
let MEAN_ALPHA  = 0.10;
let MOD_DEPTH   = 0.05;
let CHECKER_SIZE = 8;

// ---------- Pattern 5 (Adaptive Color) ----------
let p5Colors = null;
let p5Phase = 0;
let p5LastFlip = 0;
// =====================================================

console.log("[CONTENT] injected on", location.href);
hydrateFromStorageAndMaybeStart(true);

// =====================================================
// Background Detection
// =====================================================
function hydrateFromStorageAndMaybeStart(shouldStart = false) {
  chrome.storage.local.get(
    ["autoStart", "meanAlpha", "modDepth", "checkerSize", "freq", "currentPattern"],
    (s) => {
      if (typeof s.meanAlpha === "number") meanAlpha = s.meanAlpha;
      if (typeof s.modDepth === "number") MOD_DEPTH = s.modDepth;
      if (typeof s.checkerSize === "number") CHECKER_SIZE = s.checkerSize;
      if (typeof s.freq === "number") FLICKER_HZ = s.freq;
      if (typeof s.currentPattern === "number") currentPattern = s.currentPattern;

      img = null; // force redraw-safe

      console.groupCollapsed("[CONTENT] Hydrated state");
      console.log({
        meanAlpha,
        MOD_DEPTH,
        CHECKER_SIZE,
        FLICKER_HZ,
        currentPattern,
        autoStart: s.autoStart
      });
      console.groupEnd();

      if (shouldStart && s.autoStart) {
        stop();
        start(currentPattern);
      }
    }
  );
}

function getEffectiveBackgroundColor(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.documentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
    el = el.parentElement;
  }
  return getComputedStyle(document.documentElement).backgroundColor;
}

// =====================================================
// Color Utils
// =====================================================
function parseRGB(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToString({ r, g, b }) {
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function suggestOverlayColors(bgRgbStr) {
  const rgb = parseRGB(bgRgbStr);
  if (!rgb) return null;

  const L = luminance(rgb);
  const DELTA = 10;

  let base;
  if (L < 0.25) {
    base = { r: rgb.r + 8, g: rgb.g + 8, b: rgb.b + 8 };
  } else if (L > 0.75) {
    base = { r: rgb.r - 8, g: rgb.g - 8, b: rgb.b - 8 };
  } else {
    base = { ...rgb };
  }

  return {
    luminance: L.toFixed(3),
    base: rgbToString(base),
    modA: rgbToString({ r: base.r + DELTA, g: base.g, b: base.b }),
    modB: rgbToString({ r: base.r - DELTA, g: base.g, b: base.b }),
  };
}

// =====================================================
// Runtime State
// =====================================================
let running = false;
let rafId = null;
let lastTime = 0;

let phase = 0;
let acc = 0;
let squareOn = false;

let currentPattern = 1;
let meanAlpha = MEAN_ALPHA;

// canvas
let canvas = null;
let ctx = null;
let dpr = 1;
let img = null;
let imgW = 0;
let imgH = 0;

// =====================================================
// Canvas
// =====================================================
function ensureCanvas() {
  if (canvas) return;

  canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "2147483647",
  });

  document.documentElement.appendChild(canvas);
  ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = false;

  resizeCanvas();
}

function resizeCanvas() {
  if (!canvas) return;
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    img = null;
  }
}

window.addEventListener("resize", resizeCanvas);

// =====================================================
// Drawing helpers
// =====================================================
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function drawFullScreen(color, alpha) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

function drawCheckerboard(M) {
  const w = canvas.width;
  const h = canvas.height;

  if (!img || imgW !== w || imgH !== h) {
    img = ctx.createImageData(w, h);
    imgW = w;
    imgH = h;
  }

  const data = img.data;
  const scalePx = Math.max(1, Math.floor(CHECKER_SIZE * dpr));
  const m = Math.max(-1, Math.min(1, M));

  let k = 0;
  for (let y = 0; y < h; y++) {
    const iy = (y / scalePx) | 0;
    for (let x = 0; x < w; x++) {
      const ix = (x / scalePx) | 0;
      const even = ((ix + iy) & 1) === 0;
      const sgn = even ? +1 : -1;
      const a = clamp01(meanAlpha + MOD_DEPTH * sgn * m);
      const v = even ? 255 : 0;
      data[k++] = v;
      data[k++] = v;
      data[k++] = v;
      data[k++] = Math.round(a * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
}

// =====================================================
// Patterns
// =====================================================
function pattern1Update(dt) {
  acc += dt;
  const half = 1 / (FLICKER_HZ * 2);
  while (acc >= half) {
    acc -= half;
    squareOn = !squareOn;
  }
  return {
    kind: "full",
    color: "white",
    alpha: squareOn ? meanAlpha + MOD_DEPTH : meanAlpha - MOD_DEPTH,
  };
}

function pattern2Update(dt) {
  phase += 2 * Math.PI * FLICKER_HZ * dt;
  return { kind: "checker", M: Math.sin(phase) };
}

function pattern3Update(dt) {
  phase += 2 * Math.PI * FLICKER_HZ * dt;
  const w = 0.5 + 0.5 * Math.sin(phase);
  return {
    kind: "full",
    color: "red",
    alpha: meanAlpha + MOD_DEPTH * (w * 2 - 1),
  };
}

function pattern4Update(dt) {
  acc += dt;
  const half = 1 / (FLICKER_HZ * 2);
  while (acc >= half) {
    acc -= half;
    squareOn = !squareOn;
  }
  return { kind: "checker", M: squareOn ? +1 : -1 };
}

// ---------- Pattern 5 ----------
function renderPattern5(now) {
  if (!p5Colors) return;

  const halfPeriod = 1000 / (FLICKER_HZ * 2);
  if (now - p5LastFlip >= halfPeriod) {
    p5Phase ^= 1;
    p5LastFlip = now;

    // console.log(
    //   `[P5] flip phase=${p5Phase} @ ${Math.round(now)} ms`
    // );
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = clamp01(meanAlpha);
  ctx.fillStyle = p5Phase ? p5Colors.modA : p5Colors.modB;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

// =====================================================
// Loop
// =====================================================
function loop(now) {
  if (!running) return;
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (currentPattern === 5) {
    renderPattern5(now);
  } else {
    const cmd = [
      pattern1Update,
      pattern2Update,
      pattern3Update,
      pattern4Update,
    ][currentPattern - 1](dt);

    if (cmd.kind === "full") drawFullScreen(cmd.color, cmd.alpha);
    else drawCheckerboard(cmd.M);
  }

  rafId = requestAnimationFrame(loop);
}

// =====================================================
// Start / Stop
// =====================================================
function start(pattern = currentPattern) {
  ensureCanvas();
  resizeCanvas();

  currentPattern = pattern;
  phase = acc = 0;
  squareOn = true;

  if (currentPattern === 5) {
    const bg = getEffectiveBackgroundColor(innerWidth / 2, innerHeight / 2);
    p5Colors = suggestOverlayColors(bg);
    p5Phase = 0;
    p5LastFlip = performance.now();

    console.groupCollapsed("[P5] Pattern 5 initialized");
    console.log("freq:", FLICKER_HZ, "Hz");
    console.log("meanAlpha:", meanAlpha);
    console.log("background:", bg);
    console.log("adaptive colors:", p5Colors);
    console.groupEnd();
  }

  running = true;
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}


// ---------- Messaging ----------
chrome.runtime.onMessage.addListener((msg) => {
   console.log("[CONTENT] Message received:", msg);
    if (msg?.type === "START") {
  chrome.storage.local.set(
    {
      autoStart: true,
      currentPattern: msg.pattern || currentPattern
    },
    () => {
      hydrateFromStorageAndMaybeStart(true);
    }
  );
}



  if (msg?.type === "STOP") {
    stop();
    chrome.storage.local.set({ autoStart: false });
  }

  if (msg?.type === "SET_PATTERN") {
    currentPattern = Number(msg.pattern) || 1;

    chrome.storage.local.set({
      currentPattern
    });
  }

  if (msg?.type === "SET_PARAMS") {
    if (typeof msg.meanAlpha === "number") meanAlpha = msg.meanAlpha;
    if (typeof msg.modDepth === "number") MOD_DEPTH = msg.modDepth;
    if (typeof msg.checkerSize === "number") {
      CHECKER_SIZE = msg.checkerSize;
      img = null;
    }
    if (typeof msg.freq === "number") FLICKER_HZ = msg.freq;
    if (currentPattern === 5 && typeof msg.modDepth === "number") {
      const bg = getEffectiveBackgroundColor(
        window.innerWidth / 2,
        window.innerHeight / 2
      );
      p5Colors = suggestOverlayColors(bg);
    }


    chrome.storage.local.set({
      meanAlpha,
      modDepth: MOD_DEPTH,
      checkerSize: CHECKER_SIZE,
      freq: FLICKER_HZ
    });
  }
});