const FRAME_COUNT = 8;
const FRAME_INTERVAL_MS = 120;
let animationIntervalId = null;
let originalFaviconHref = null;
let currentFrame = 0;
let animationFrames = null;

function getFaviconLink() {
  if (typeof document === "undefined") {
    return null;
  }

  let iconLink = document.querySelector('link[rel="icon"]');
  if (!iconLink) {
    iconLink = document.createElement("link");
    iconLink.rel = "icon";
    document.head.appendChild(iconLink);
  }
  return iconLink;
}

function buildAnimationFrames() {
  if (animationFrames) {
    return animationFrames;
  }

  animationFrames = Array.from({ length: FRAME_COUNT }, (_, index) => {
    const angle = (index / FRAME_COUNT) * 360;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" ry="14" fill="#111827" />
        <circle cx="32" cy="32" r="24" fill="none" stroke="#4b5563" stroke-width="6" opacity="0.4" />
        <circle cx="32" cy="32" r="18" fill="#111827" stroke="#ef4444" stroke-width="4" />
        <text x="32" y="40" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#f9fafb">G</text>
        <g transform="translate(32 32) rotate(${angle})">
          <path d="M0,-22 A22,22 0 0,1 12,-6" fill="none" stroke="#f97316" stroke-width="5" stroke-linecap="round" opacity="0.9" />
          <circle cx="0" cy="-22" r="4" fill="#ef4444" />
        </g>
      </svg>
    `;

    const encoded = btoa(svg);
    return `data:image/svg+xml;base64,${encoded}`;
  });

  return animationFrames;
}

function setFaviconHref(href) {
  const iconLink = getFaviconLink();
  if (!iconLink) return;
  iconLink.href = href;
}

function isAnimationFavicon(href) {
  if (!href || !animationFrames) return false;
  return animationFrames.includes(href);
}

export function startFaviconAnimation() {
  if (typeof window === "undefined") return;
  if (animationIntervalId) return;

  const iconLink = getFaviconLink();
  if (!iconLink) return;

  if (!originalFaviconHref) {
    originalFaviconHref = iconLink.href || "";
  }

  const frames = buildAnimationFrames();
  setFaviconHref(frames[currentFrame]);

  animationIntervalId = window.setInterval(() => {
    currentFrame = (currentFrame + 1) % frames.length;
    setFaviconHref(frames[currentFrame]);
  }, FRAME_INTERVAL_MS);
}

export function stopFaviconAnimation() {
  if (typeof window === "undefined") return;
  if (!animationIntervalId) return;

  window.clearInterval(animationIntervalId);
  animationIntervalId = null;
  currentFrame = 0;

  const iconLink = getFaviconLink();
  if (!iconLink) {
    originalFaviconHref = null;
    return;
  }

  const currentHref = iconLink.href || "";
  if (originalFaviconHref && isAnimationFavicon(currentHref)) {
    setFaviconHref(originalFaviconHref);
  }
  originalFaviconHref = null;
}
