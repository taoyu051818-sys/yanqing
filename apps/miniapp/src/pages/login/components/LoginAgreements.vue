<script setup lang="ts">
import ActionDialog from '../../../components/ActionDialog.vue'
defineProps<{ kind: 'terms' | 'privacy' }>()
defineEmits<{ close: []; decline: [] }>()
</script>
<template>
  <ActionDialog :title="kind === 'terms' ? '用户服务协议' : '隐私保护指引'" @close="$emit('close')">
    <view class="agreement-copy">
      <text class="agreement-date">更新日期：2026年9月13日</text>
      <template v-if="kind === 'terms'">
        <text class="agreement-heading">服务与选择</text>
        <text>延庆金羽羽毛球小程序提供场地预约、活动报名、订单查询及会员服务。你可以不登录浏览场地、球局和赛事；提交预约、报名及查询个人订单需要登录以确认订单归属。不同意协议时，可选择“暂不登录，继续浏览”。</text>
        <text class="agreement-heading">预约、支付与退款</text>
        <text>预约或报名前，请核对页面列明的场地、日期、时段、费用、名额及取消规则。订单和报名是否生效，以订单或报名页面展示的状态为准。待支付订单可能超时关闭；支付、取消或退款进度可在本人订单中查询。有疑问请联系球馆前台核实。</text>
        <text class="agreement-heading">资料与使用</text>
        <text>请按实际业务需要填写真实、准确的信息，并保管好自己的账号。头像和昵称可在“我的—资料与设置”中自主完善。请勿冒用他人身份、恶意占位或干扰正常运营。涉及未成年人报名的，请由监护人了解活动安排并协助办理。</text>
        <text class="agreement-heading">咨询与账号管理</text>
        <text>服务运营主体以本小程序资料页公示为准。业务问题可向球馆前台咨询；你可以在“我的—资料与设置”退出登录或提交账号注销申请。注销前如有未完成订单或退款，需要先核实处理相关业务。</text>
      </template>
      <template v-else>
        <text class="agreement-heading">浏览与登录</text>
        <text>不登录也能浏览公开场地、球局和赛事。你主动同意协议并选择微信登录后，我们通过微信登录凭证获取微信用户标识，用于建立账号、识别本人及关联订单。登录不要求授权手机号、头像或昵称。</text>
        <text class="agreement-heading">按功能提供的信息</text>
        <text>头像、昵称由你在资料设置中自主提供，用于会员识别及报名展示。预约、活动、培训等业务会按页面所示用途使用你填写的联系人、手机号、报名或学员信息，以及相应订单、支付、退款和签到记录。请按实际需要填写，公开浏览不要求提供这些信息。</text>
        <text class="agreement-heading">数据使用与保护</text>
        <text>业务数据用于履行预约和报名服务、处理支付退款、核对账务及汇总经营情况。微信登录、支付由相应微信服务支持；工作人员按岗位权限处理业务记录。活动页面可展示主理人资料及报名人数，个人订单与联系方式不随公开活动列表提供给游客。</text>
        <text class="agreement-heading">查询、更正与注销</text>
        <text>你可在“我的”查询个人订单、在“资料与设置”修改头像昵称或申请注销与匿名化。注销申请需先核实未完成业务；需留存的交易和审计记录按系统注销流程处理。隐私相关问题请联系球馆前台，运营主体及联系方式请核对小程序资料页公示信息。</text>
        <text class="agreement-heading">你的选择</text>
        <text>协议选项默认不勾选，阅读或关闭本窗口均不会替你同意。拒绝登录不影响公开浏览；退出登录后，个人业务需再次登录才能查询。微信提供的隐私授权如被拒绝，可返回继续使用不涉及该授权的功能。</text>
      </template>
    </view>
    <template #footer>
      <view class="agreement-actions">
        <button class="secondary" @tap="$emit('close')">返回登录</button>
        <button class="secondary" @tap="$emit('decline')">不同意，继续浏览</button>
      </view>
    </template>
  </ActionDialog>
</template>
<style scoped>
.agreement-copy { display:grid; gap:20rpx; text-align:left; color:var(--color-foreground); font-size:27rpx; line-height:1.8; }
.agreement-date { color:var(--color-muted); font-size:24rpx; }
.agreement-heading { margin-top:12rpx; color:var(--color-primary-strong); font-weight:750; }
.agreement-actions { display:grid; gap:16rpx; }
.agreement-actions button { width:100%; min-height:88rpx; }
</style>
