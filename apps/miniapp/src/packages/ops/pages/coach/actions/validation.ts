export function requiredReason(value: string) {
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 300) {
    throw new Error("操作原因必须填写 2-300 个字符。");
  }
  return reason;
}

export function positiveInteger(
  value: string,
  label: string,
  min = 1,
  max?: number,
) {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    (max !== undefined && parsed > max)
  ) {
    throw new Error(
      max === undefined
        ? `${label}必须为不小于 ${min} 的整数。`
        : `${label}必须为 ${min}-${max} 的整数。`,
    );
  }
  return parsed;
}

export function yuanToCents(value: string, label: string, positive = false) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label}必须为非负金额，最多两位小数。`);
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < (positive ? 1 : 0)) {
    throw new Error(`${label}${positive ? "必须大于 0" : "不能为负数"}。`);
  }
  return cents;
}
