import { createSign, createVerify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const readPem = (valueKey, pathKey) => {
  const inlineValue = process.env[valueKey];
  if (inlineValue) return inlineValue.replace(/\\n/g, '\n');
  return readFileSync(required(pathKey), 'utf8');
};

const mchId = required('WECHAT_PAY_MCH_ID');
const merchantSerial = required('WECHAT_PAY_SERIAL_NO');
const privateKey = readPem(
  'WECHAT_PAY_PRIVATE_KEY',
  'WECHAT_PAY_PRIVATE_KEY_PATH',
);
const publicKeyId = required('WECHAT_PAY_PUBLIC_KEY_ID');
const publicKey = readPem(
  'WECHAT_PAY_PUBLIC_KEY',
  'WECHAT_PAY_PUBLIC_KEY_PATH',
);

const request = async (method, path, payload) => {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const signer = createSign('RSA-SHA256');
  signer.update(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
  const signature = signer.sign(privateKey, 'base64');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${merchantSerial}",signature="${signature}"`;

  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method,
    headers: {
      authorization,
      accept: 'application/json',
      'accept-encoding': 'identity',
      'content-type': 'application/json',
      'user-agent': 'yanqing-badminton-security-echo/1.0',
      'Wechatpay-Serial': publicKeyId,
    },
    ...(body ? { body } : {}),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    let safeMessage = `HTTP ${response.status}`;
    try {
      const errorBody = JSON.parse(responseBody);
      safeMessage =
        `${safeMessage}: ${errorBody.code ?? 'UNKNOWN'} ${errorBody.message ?? ''}`.trim();
    } catch {
      // Keep the status-only error to avoid echoing an unexpected response body.
    }
    throw new Error(safeMessage);
  }

  const responseSerial = response.headers.get('wechatpay-serial');
  const responseTimestamp = response.headers.get('wechatpay-timestamp');
  const responseNonce = response.headers.get('wechatpay-nonce');
  const responseSignature = response.headers.get('wechatpay-signature');
  if (
    !responseSerial ||
    !responseTimestamp ||
    !responseNonce ||
    !responseSignature
  ) {
    throw new Error('WeChat Pay response signature headers are incomplete');
  }
  if (responseSerial !== publicKeyId) {
    throw new Error(
      'WeChat Pay response public key id does not match configuration',
    );
  }
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${responseTimestamp}\n${responseNonce}\n${responseBody}\n`);
  if (!verifier.verify(publicKey, responseSignature, 'base64')) {
    throw new Error('WeChat Pay response signature verification failed');
  }
  return {
    body: responseBody ? JSON.parse(responseBody) : undefined,
    publicKeyId: responseSerial,
    status: response.status,
  };
};

const echoMessage = `yanqing-wechat-pay-${Date.now()}`;
const notifyUrl = process.env.WECHAT_PAY_NOTIFY_URL;
const echoResponse = await request('POST', '/v3/security/echo', {
  echo_message: echoMessage,
  ...(notifyUrl ? { notify_url: notifyUrl } : {}),
});
if (echoResponse.body?.echo_message !== echoMessage) {
  throw new Error('WeChat Pay echo response does not match the request');
}

console.log('wechat_pay_security_echo=passed');
console.log(`http_status=${echoResponse.status}`);
console.log(`response_public_key_id=${echoResponse.publicKeyId}`);
console.log(`callback_requested=${notifyUrl ? 'yes' : 'no'}`);

const testOpenId = process.env.WECHAT_PAY_TEST_OPEN_ID;
if (testOpenId) {
  const appId = required('WECHAT_APP_ID');
  const outTradeNo = `YQVERIFY${Date.now()}${randomBytes(2).toString('hex')}`;
  const paymentResponse = await request('POST', '/v3/pay/transactions/jsapi', {
    appid: appId,
    mchid: mchId,
    description: '支付配置联通校验（勿支付）',
    out_trade_no: outTradeNo,
    notify_url: required('WECHAT_PAY_NOTIFY_URL'),
    amount: { total: 1, currency: 'CNY' },
    payer: { openid: testOpenId },
  });
  if (!paymentResponse.body?.prepay_id) {
    throw new Error('JSAPI preflight response does not contain prepay_id');
  }
  console.log('wechat_pay_jsapi_preflight=passed');

  await request(
    'POST',
    `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`,
    { mchid: mchId },
  );
  console.log('wechat_pay_jsapi_preflight_order=closed');
}
