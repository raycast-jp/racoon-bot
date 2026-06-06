import crypto from "node:crypto";

/**
 * Slack のリクエスト署名を検証する。
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackRequest(
  signingSecret: string,
  rawBody: string,
  timestamp: string | null | undefined,
  signature: string | null | undefined
): boolean {
  if (!timestamp || !signature) return false;

  // リプレイ攻撃対策: 5 分以上古いリクエストは拒否
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const expected = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
