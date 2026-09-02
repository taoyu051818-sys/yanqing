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
  --color-foreground: #18221c;
  --color-muted: #5f6f65;
  --color-border: rgba(28, 63, 43, .11);
  --color-danger: #a52626;
  --radius-sm: 16rpx;
  --radius-md: 24rpx;
  --radius-lg: 32rpx;
  --shadow-sm: 0 6rpx 18rpx rgba(26, 56, 38, .05);
  --shadow-md: 0 12rpx 36rpx rgba(26, 56, 38, .08);
  --motion-fast: 180ms;
  min-height: 100%;
  color: var(--color-foreground);
  background: var(--color-background);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

button,
uni-button {
  box-sizing: border-box;
  min-width: 44px !important;
  min-height: 44px !important;
  font-weight: 650;
  transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, opacity var(--motion-fast) ease, transform var(--motion-fast) ease;
  touch-action: manipulation;
}
button[disabled],
uni-button[disabled] { opacity: .48; box-shadow: none; }
button::after { border: none; }

input,
textarea,
uni-input,
uni-textarea,
.uni-input-wrapper,
.uni-input-input,
.uni-textarea-wrapper,
.uni-textarea-textarea {
  box-sizing: border-box;
  min-height: 44px !important;
}

.page { box-sizing: border-box; width: 100%; padding: 28rpx 28rpx 64rpx; overflow-x: clip; }
.card {
  padding: 28rpx;
  margin-bottom: 22rpx;
  background: var(--color-surface);
  border: 1rpx solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.section-title { margin: 38rpx 0 18rpx; color: var(--color-foreground); font-size: 34rpx; font-weight: 800; letter-spacing: -.4rpx; }
.muted { color: var(--color-muted); font-size: 25rpx; line-height: 1.55; }
.money { color: var(--color-primary-strong); font-weight: 750; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.primary, .secondary, .danger {
  min-height: 44px;
  border-radius: 22rpx;
  font-size: 28rpx;
  line-height: 82rpx;
}
.primary { color: #fff; background: var(--color-primary); box-shadow: 0 8rpx 22rpx rgba(23,101,61,.18); }
.secondary { color: var(--color-primary); background: var(--color-primary-soft); }
.danger { color: var(--color-danger); background: #fff0ef; }
.pill { display: inline-flex; align-items: center; min-height: 40rpx; padding: 6rpx 16rpx; color: var(--color-primary); background: var(--color-primary-soft); border-radius: 999rpx; font-size: 22rpx; line-height: 1.35; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18rpx; }
.input { min-height: 78rpx; padding: 0 22rpx; background: #f5f7f4; border: 1rpx solid transparent; border-radius: 18rpx; }
.safe-bottom { padding-bottom: calc(28rpx + env(safe-area-inset-bottom)); }

/* #ifdef H5 */
button:hover:not([disabled]),
uni-button:hover:not([disabled]) { opacity: .93; }
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
/*
 * The H5 build is a desktop acceptance surface for a mobile-first product.
 * On a desktop we deliberately keep one 390px mobile canvas instead of
 * stretching business pages into an accidental desktop layout. Real mobile
 * browsers and the WeChat build continue to use their native viewport width.
 */
@media (min-width: 600px) {
  html {
    min-height: 100%;
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
