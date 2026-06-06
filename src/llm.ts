import { createGateway } from "@ai-sdk/gateway";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { config } from "./config";

// Vercel AI Gateway 経由で Anthropic モデルを呼び出す
const gateway = createGateway({ apiKey: config.aiGatewayApiKey });

const SYSTEM_PROMPT = `あなたは Slack ワークスペースの会話ログをすべて記憶しているアシスタント bot です。
ユーザーからの質問に対して、searchLogs ツールで過去ログを検索し、その内容を根拠に日本語で回答してください。

ルール:
- まず searchLogs で関連ログを検索する。ヒットが薄ければキーワードを変えて検索し直してよい（カタカナ/英語などの表記ゆれも試す）
- 回答はログの内容を根拠にする。ログに情報がない場合は「ログには見つかりませんでした」と正直に伝える
- 根拠となった発言は「いつ・どのチャンネルで・誰が」言ったかを添える
- Slack に投稿されるため、簡潔にまとめる（長くても 10 行程度）
- Slack の mrkdwn 記法を使う（*太字*、\`コード\`、> 引用。** や # は使わない）`;

/**
 * 過去ログを根拠に質問へ回答する。
 * 全文検索は searchLogs ツールとしてモデルに渡し、必要に応じて繰り返し呼び出させる。
 */
export async function answerQuestion(
  question: string,
  recentContext: string,
  searchLogs: (keywords: string[]) => Promise<string>
): Promise<string> {
  const result = await generateText({
    model: gateway(config.answerModel),
    system: SYSTEM_PROMPT,
    prompt: [
      "## 質問されたチャンネルの直近の会話",
      recentContext || "(なし)",
      "",
      "## 質問",
      question,
    ].join("\n"),
    tools: {
      searchLogs: tool({
        description:
          "Slack の過去ログをキーワードで全文検索する。キーワードは固有名詞・専門用語など話題の中心となる語を 3〜8 個。" +
          "助詞や一般的すぎる語（「こと」「方法」など）は含めないこと。",
        inputSchema: z.object({
          keywords: z
            .array(z.string())
            .describe("検索キーワード（日本語は 3 文字以上が部分一致しやすい）"),
        }),
        execute: async ({ keywords }) => searchLogs(keywords),
      }),
    },
    stopWhen: stepCountIs(5),
    maxOutputTokens: 16000,
  });

  return result.text.trim();
}
