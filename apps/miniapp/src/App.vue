<script lang="ts">
export default {
  onLaunch() {
    // Keep the root app component explicit for uni-app's MP compiler.
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

button::after { border: none; }

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
  min-height: 82rpx;
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
</style>
