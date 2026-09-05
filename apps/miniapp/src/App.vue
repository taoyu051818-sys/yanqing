<script lang="ts">
import {
  captureReferralAttribution,
  type ReferralLaunchOptions,
} from './services/referral-attribution'

export default {
  onLaunch(options?: ReferralLaunchOptions) {
    captureReferralAttribution(options)
  },
  onShow(options?: ReferralLaunchOptions) {
    // A shared card can open an already-running mini program, so the hot-start
    // path must capture the same immutable attribution as a cold launch.
    captureReferralAttribution(options)
  },
}
</script>

<style>
page {
  --color-primary: #17653d;
  --color-primary-strong: #123f29;
  --color-primary-soft: #e7f4eb;
  --color-accent: #b68b22;
  --color-on-accent: #18221c;
  --color-background: #f3f6f2;
  --color-surface: #ffffff;
  --color-surface-subtle: #f7f9f6;
  --color-foreground: #18221c;
  --color-muted: #5f6f65;
  --color-border: rgba(28, 63, 43, .11);
  --color-danger: #a52626;
  --color-danger-soft: #fff0ef;
  --color-warning: #9a6f12;
  --color-warning-soft: #fff8e6;
  --color-success: #17653d;
  --color-success-soft: #e7f4eb;
  --radius-sm: 16rpx;
  --radius-md: 24rpx;
  --radius-lg: 32rpx;
  --shadow-sm: 0 6rpx 18rpx rgba(26, 56, 38, .05);
  --shadow-md: 0 12rpx 36rpx rgba(26, 56, 38, .08);
  --motion-fast: 180ms;
  --motion-standard: 240ms;
  min-height: 100%;
  color: var(--color-foreground);
  background: var(--color-background);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

button,
uni-button {
  display: flex !important;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 44px !important;
  min-height: 44px !important;
  gap: 10rpx;
  font-weight: 650;
  line-height: 1.3 !important;
  text-align: center;
  white-space: normal;
  transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, opacity var(--motion-fast) ease, transform var(--motion-fast) ease;
  touch-action: manipulation;
}
button > image,
uni-button > image,
button .app-icon,
uni-button .app-icon {
  align-self: center;
  margin-top: 0;
  margin-bottom: 0;
  vertical-align: middle;
}
button[disabled],
uni-button[disabled] { opacity: .48; box-shadow: none; }
button::after,
uni-button::after { border: none; pointer-events: none; }

input,
textarea,
uni-input,
uni-textarea {
  box-sizing: border-box;
  min-height: 44px !important;
}

/* #ifdef H5 */
/* Keep uni-app's internal input layers aligned without increasing every layer. */
uni-input .uni-input-wrapper {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-height: inherit;
}
uni-input .uni-input-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 0 !important;
  line-height: 1.4;
}
/* #endif */

.page { box-sizing: border-box; width: 100%; padding: 28rpx 28rpx 64rpx; overflow-x: clip; }
.card {
  padding: 28rpx;
  margin-bottom: 22rpx;
  background: var(--color-surface);
  border: 1rpx solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.card[role="button"] { transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease, opacity var(--motion-fast) ease, transform var(--motion-fast) ease; }
.section-title { margin: 38rpx 0 18rpx; color: var(--color-foreground); font-size: 34rpx; font-weight: 800; letter-spacing: -.4rpx; }
.muted { color: var(--color-muted); font-size: 25rpx; line-height: 1.55; }
.money { color: var(--color-primary-strong); font-weight: 750; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.primary, .secondary, .danger {
  min-height: 44px;
  padding: 12rpx 24rpx;
  border-radius: 22rpx;
  font-size: 28rpx;
  line-height: 1.3;
}
.primary { color: #fff; background: var(--color-primary); box-shadow: 0 8rpx 22rpx rgba(23,101,61,.18); }
.secondary { color: var(--color-primary); background: var(--color-primary-soft); }
.danger { color: var(--color-danger); background: #fff0ef; }
.pill { display: inline-flex; align-items: center; justify-content: center; min-height: 40rpx; padding: 6rpx 16rpx; color: var(--color-primary); background: var(--color-primary-soft); border-radius: 999rpx; font-size: 22rpx; line-height: 1.35; text-align: center; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18rpx; }
.input { min-height: 78rpx; padding: 0 22rpx; background: #f5f7f4; border: 1rpx solid transparent; border-radius: 18rpx; }
.icon-surface { display: grid; place-items: center; flex: 0 0 auto; background: var(--color-primary-soft); border-radius: 16rpx; }
.skeleton { position: relative; overflow: hidden; color: transparent !important; background: #e4eae4 !important; border-color: transparent !important; box-shadow: none !important; }
.skeleton::after { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.72) 45%, transparent 70%); transform: translateX(-100%); animation: skeleton-wave 1.25s ease-in-out infinite; content: ''; }
@keyframes skeleton-wave { to { transform: translateX(100%); } }
.safe-bottom { padding-bottom: calc(28rpx + env(safe-area-inset-bottom)); }

/* #ifdef H5 */
button:hover:not([disabled]),
uni-button:hover:not([disabled]) { opacity: .93; }
.card[role="button"]:hover { border-color: rgba(23,101,61,.24); box-shadow: var(--shadow-md); }
button:active:not([disabled]),
uni-button:active:not([disabled]),
[role="button"]:active { transform: translateY(1px); opacity: .88; }
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  outline: 3px solid rgba(182, 139, 34, .72);
  outline-offset: 2px;
}
[role="button"] { cursor: pointer; touch-action: manipulation; transition: box-shadow var(--motion-fast) ease, border-color var(--motion-fast) ease, opacity var(--motion-fast) ease, transform var(--motion-fast) ease; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
/* #endif */

/* #ifdef H5 */
/* Keep rem/rpx stable during viewport capture, keyboard and route transitions.
   This matches uni-app's width / 23.4375 calculation without a JS resize race. */
@media (max-width: 599px) {
  html { font-size: 4.2666666667vw !important; }
}
/* uni-app preloads an off-screen navigation-shadow PNG from a public CDN.
   The app uses local CSS shadows, so no external preload is necessary. */
body::after { animation: none !important; background-image: none !important; }
/*
 * The H5 build is a desktop acceptance surface for a mobile-first product.
 * On a desktop we deliberately keep one 390px mobile canvas instead of
 * stretching business pages into an accidental desktop layout. Real mobile
 * browsers and the WeChat build continue to use their native viewport width.
 */
@media (min-width: 600px) {
  html {
    min-height: 100%;
    /* uni-app derives rpx from the desktop viewport. Pinning the root unit
       keeps the 390px acceptance canvas at real phone density. */
    font-size: 16px !important;
    background: #dfe6df;
  }

  body {
    min-height: 100%;
    margin: 0;
    background:
      radial-gradient(circle at 18% 10%, rgba(193, 161, 73, .16), transparent 28%),
      radial-gradient(circle at 82% 22%, rgba(23, 101, 61, .13), transparent 30%),
      #e9eeea;
  }

  #app,
  uni-app {
    width: 390px !important;
    min-height: 100vh;
    margin-right: auto;
    margin-left: auto;
    background: #f3f6f2;
  }

  #app {
    position: relative;
    transform: translateZ(0);
    box-shadow: 0 0 0 1px rgba(24, 34, 28, .08), 0 24px 72px rgba(24, 34, 28, .18);
  }

  uni-page {
    right: auto !important;
    left: 0 !important;
    width: 100% !important;
    transform: none;
  }

  uni-page-head .uni-page-head,
  uni-tabbar.uni-tabbar-bottom {
    right: auto !important;
    left: 0 !important;
    width: 100% !important;
    transform: none;
  }

  uni-tabbar.uni-tabbar-bottom .uni-tabbar {
    width: 100% !important;
  }
}
/* #endif */
</style>
