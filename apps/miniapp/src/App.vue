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
  min-height: 100%;
  color: #18221c;
  background: #f3f6f2;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

button,
uni-button {
  box-sizing: border-box;
  min-width: 44px !important;
  min-height: 44px !important;
}
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

.page { padding: 28rpx 28rpx 64rpx; }
.card {
  padding: 28rpx;
  margin-bottom: 22rpx;
  background: #fff;
  border: 1rpx solid rgba(28, 63, 43, .08);
  border-radius: 28rpx;
  box-shadow: 0 10rpx 32rpx rgba(26, 56, 38, .06);
}
.section-title { margin: 32rpx 0 18rpx; font-size: 34rpx; font-weight: 700; }
.muted { color: #758079; font-size: 25rpx; }
.money { color: #155a37; font-weight: 700; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.primary, .secondary, .danger {
  min-height: 44px;
  border-radius: 22rpx;
  font-size: 28rpx;
  line-height: 82rpx;
}
.primary { color: #fff; background: #17653d; }
.secondary { color: #17653d; background: #e8f2eb; }
.danger { color: #a52626; background: #fff0ef; }
.pill { display: inline-flex; padding: 8rpx 16rpx; color: #17653d; background: #e7f4eb; border-radius: 999rpx; font-size: 22rpx; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18rpx; }
.input { min-height: 78rpx; padding: 0 22rpx; background: #f5f7f4; border-radius: 18rpx; }
.safe-bottom { padding-bottom: calc(28rpx + env(safe-area-inset-bottom)); }

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
