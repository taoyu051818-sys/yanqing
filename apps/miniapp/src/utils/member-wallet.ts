import type { Account } from '../types/domain'
import { money } from './format'

export const accountLabels: Record<string, string> = {
  CASH_PRINCIPAL: '充值余额', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币',
  EVENT_POINTS: '赛事积分', GROWTH_POINTS: '成长积分', YOUTH_GROWTH_POINTS: '成长积分',
}
export const isMoneyAccount = (type: string) => ['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(type)
export const accountAmount = (type: string, amount: number) => isMoneyAccount(type)
  ? money(amount)
  : `${amount}${type === 'BADMINTON_COIN' ? ' 币' : ' 分'}`

export function relevantAccounts(accounts: Account[], transactions: any[], showAll = false) {
  return accounts.filter((account) => showAll || isMoneyAccount(account.type) || account.balance !== 0 || account.frozenBalance !== 0 ||
    transactions.some((item) => item.account?.type === account.type || item.accountId === account.id))
}

export function walletGroup(type: string) {
  return isMoneyAccount(type) ? '场馆余额' : type === 'BADMINTON_COIN' ? '奖励权益' : '运动记录'
}
