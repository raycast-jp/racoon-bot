import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

// Vercel AI Gateway 経由で Anthropic モデルを呼び出す
const anthropic = new Anthropic({
  apiKey: config.aiGatewayApiKey,
  baseURL: "https://ai-gateway.vercel.sh",
});

/**
 * 質問文から全文検索用のキーワードを抽出する（軽量モデルを使用）。
 */
export async function extractKeywords(question: string): Promise<string[]> {
  const response = await anthropic.messages.create({
    model: config.keywordModel,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          "次の質問に答えるために Slack の会話ログを全文検索します。",
          "検索に有効なキーワードを 3〜8 個抽出してください。",
          "- 固有名詞・専門用語・話題の中心となる語を優先する",
          "- 表記ゆれが想定される場合は別表記も含める（例: カタカナ/英語）",
          "- 助詞や一般的すぎる語（「こと」「方法」など）は含めない",
          "",
          `質問: ${question}`,
        ].join("\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["keywords"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  try {
    const parsed = JSON.parse(text) as { keywords?: string[] };
    return (parsed.keywords ?? []).filter((k) => k.trim().length > 0);
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `あなたは Slack ワークスペースの会話ログをすべて記憶しているアシスタント bot です。
ユーザーからの質問に対して、提供された過去の会話ログを根拠に日本語で回答してください。

ルール:
- 回答はログの内容を根拠にする。ログに情報がない場合は「ログには見つかりませんでした」と正直に伝える
- 根拠となった発言は「いつ・どのチャンネルで・誰が」言ったかを添える
- Slack に投稿されるため、簡潔にまとめる（長くても 10 行程度）
- Slack の mrkdwn 記法を使う（*太字*、\`コード\`、> 引用。** や # は使わない）`;

/**
 * 検索結果と直近の会話ログを根拠に質問へ回答する。
 */
export async function answerQuestion(
  question: string,
  searchContext: string,
  recentContext: string
): Promise<string> {
  const response = await anthropic.messages.create({
    model: config.answerModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          "## 全文検索でヒットした過去ログ",
          searchContext || "(ヒットなし)",
          "",
          "## 質問されたチャンネルの直近の会話",
          recentContext || "(なし)",
          "",
          "## 質問",
          question,
        ].join("\n"),
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
