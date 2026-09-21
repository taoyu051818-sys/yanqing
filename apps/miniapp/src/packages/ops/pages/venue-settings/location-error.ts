export function locationFailure(cause: { errMsg?: string } | undefined) {
  const message = cause?.errMsg || ''
  if (/cancel/i.test(message)) return { message: '', settings: false }
  if (/privacy|privacyauthorization|隐私/i.test(message)) {
    return {
      message:
        '地图选点需要同意位置相关的隐私授权；若仍无法打开，请联系管理员检查微信后台的隐私声明。也可直接填写文字地址。',
      settings: false,
    }
  }
  if (/auth deny|auth denied|authorize.*(deny|fail)|用户拒绝/i.test(message)) {
    return { message: '尚未允许使用位置。可打开授权设置后重新选点，也可以直接填写文字地址。', settings: true }
  }
  if (/system permission|system.*(deny|denied)|gps|location service/i.test(message)) {
    return { message: '请检查手机定位服务及微信的位置权限，再重新选点；也可直接填写文字地址。', settings: false }
  }
  if (/permission|not declared|not in.*(list|scope)|not authorized|无权限|未开通/i.test(message)) {
    return {
      message: '小程序地图权限尚未就绪，请联系管理员在微信后台开通地图选点接口。当前可直接填写文字地址。',
      settings: false,
    }
  }

  return { message: '地图暂时无法打开，请稍后重新选点或直接填写文字地址。', settings: false }
}
