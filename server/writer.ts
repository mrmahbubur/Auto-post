import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type { AiSettings, Article, CopyDeck, SiteConfig } from "./types.ts";
import { firstSentences, formatHashtags, stripHtml, truncateAt } from "./util.ts";

const VALID_MODELS = new Set(["gemini-4-hydrogen", "gemini-3.1-flash-lite"]);

function resolveModel(configured?: string): string {
  if (configured && VALID_MODELS.has(configured)) return configured;
  if (configured && /hydrogen|gemini-4/i.test(configured)) return "gemini-4-hydrogen";
  return "gemini-3.1-flash-lite";
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function buildSystemInstruction(siteName: string, voice: string): string {
  return `You are the social-media editor for ${siteName}. You write platform-native copy that sounds like a human who actually built the thing — never like a press release.
Brand voice: ${voice || "Direct, friendly, first-person-plural. Short sentences."}
Hard rules:
- Lead with the concrete payoff or the surprising detail. No throat-clearing.
- Never invent facts, numbers, quotes or features that are not in the source.
- No clickbait ("you won't believe"), no ALL CAPS, at most 2 emoji.
- Every caption (except hook, reddit_title, devto_title, devto_description) must include the exact URL given.
- Respect each platform's character budget (counted including the URL):
  - hook: <=90 chars, headline for a 1200x630 thumbnail, no URL, no emoji
  - bsky: <=280 chars, conversational, 1 question or takeaway, 1-2 hashtags
  - mastodon: <=480 chars, community tone, 2-3 hashtags
  - telegram: <=700 chars, use one line break and a single emoji, plain text
  - discord: <=350 chars, casual, ends with the link
  - facebook_page: <=500 chars, friendly and story-shaped, first 2 lines must work alone
  - linkedin: <=700 chars, professional, insight first, max 3 hashtags
  - x: <=260 chars, punchy, 1 hashtag
  - threads: <=480 chars, chatty, no hashtags
  - reddit_title: <=300 chars, plain and informative, NO clickbait, no emoji
  - reddit_body: <=900 chars, helpful context, no marketing language, disclose it is your site
  - devto_title: <=100 chars
  - devto_description: <=140 chars
  - pinterest: <=480 chars, visual discovery pin description with takeaway + URL
  - hashtags: array of 4 short tags without the # sign
- Vary the angle per platform; do not paste the same sentence everywhere.`;
}

async function generateWithGemini(
  article: Article,
  aiSettings: AiSettings,
  site: SiteConfig
): Promise<Partial<CopyDeck> | null> {
  const ai = getAiClient();
  if (!ai) return null;

  let model = resolveModel(aiSettings.model);
  const prompt = `SOURCE
Title: ${article.title}
URL: ${article.url}
Summary: ${article.summary || "(none provided — stay generic, invent nothing)"}
Tags: ${(article.tags.length ? article.tags : site.hashtags).join(", ") || "(none)"}

Generate the complete 14-field JSON social copy deck following every character limit and voice rule.`;

  const maxAttempts = 2;
  let lastErrMsg = "Unknown Gemini error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const genPromise = ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: buildSystemInstruction(site.name, aiSettings.brand_voice),
          responseMimeType: "application/json",
          ...(model === "gemini-4-hydrogen"
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hook: { type: Type.STRING },
              bsky: { type: Type.STRING },
              mastodon: { type: Type.STRING },
              telegram: { type: Type.STRING },
              discord: { type: Type.STRING },
              facebook_page: { type: Type.STRING },
              linkedin: { type: Type.STRING },
              x: { type: Type.STRING },
              threads: { type: Type.STRING },
              reddit_title: { type: Type.STRING },
              reddit_body: { type: Type.STRING },
              devto_title: { type: Type.STRING },
              devto_description: { type: Type.STRING },
              pinterest: { type: Type.STRING },
              hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              "hook",
              "bsky",
              "mastodon",
              "telegram",
              "discord",
              "facebook_page",
              "linkedin",
              "x",
              "threads",
              "reddit_title",
              "reddit_body",
              "devto_title",
              "devto_description",
              "pinterest",
              "hashtags",
            ],
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Gemini request timed out after 45s")), 45000);
      });
      const response = await Promise.race([genPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);

      const raw = (response.text ?? "").trim();
      if (!raw) {
        throw new Error("Gemini returned an empty response.");
      }
      const cleaned = raw.replace(/^```(?:json)?|```$/gm, "").trim();
      const parsed = JSON.parse(cleaned) as Partial<CopyDeck>;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Gemini response was not a valid JSON object.");
      }
      return parsed;
    } catch (err) {
      if (timer) clearTimeout(timer);
      const rawMsg = err instanceof Error ? err.message : String(err);
      let friendlyMsg = rawMsg;
      try {
        const jsonStart = rawMsg.indexOf("{");
        if (jsonStart >= 0) {
          const parsedErr = JSON.parse(rawMsg.slice(jsonStart)) as {
            error?: { code?: number; message?: string; status?: string };
          };
          if (parsedErr?.error?.message) {
            friendlyMsg = `${parsedErr.error.status || parsedErr.error.code || "API"}: ${parsedErr.error.message.split("\n")[0]}`;
          }
        }
      } catch {
        // Keep rawMsg if not JSON
      }
      lastErrMsg = friendlyMsg;
      const quotaExhausted = /RESOURCE_EXHAUSTED|QuotaFailure|\b429\b/i.test(rawMsg);
      if (quotaExhausted && model !== "gemini-3.1-flash-lite" && attempt < maxAttempts) {
        model = "gemini-3.1-flash-lite";
        continue;
      }
      const nonRetryable = /API_KEY_INVALID|PERMISSION_DENIED|RESOURCE_EXHAUSTED|QuotaFailure|\b400\b|\b401\b|\b403\b|\b429\b/i.test(
        rawMsg
      );
      if (attempt < maxAttempts && !nonRetryable) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      console.error("Gemini writer error:", friendlyMsg);
      throw new Error(`Gemini AI generation failed (${model}): ${friendlyMsg}`);
    }
  }
  throw new Error(`Gemini AI generation failed (${model}): ${lastErrMsg}`);
}

function compose(body: string, url: string, tags: string, limit: number): string {
  let tail = `\n\n${url}`;
  if (tags) tail += `\n\n${tags}`;
  const room = limit - tail.length;
  if (room < 40) {
    return (limit < 120 ? url : `${url}\n\n${tags}`).slice(0, limit);
  }
  const fitted = firstSentences(body, room);
  return `${fitted}${tail}`.slice(0, limit);
}

export function templateDeck(article: Article, site: SiteConfig): CopyDeck {
  const title = article.title.replace(/[ .]+$/, "");
  const siteName = site.name;
  const url = article.url;
  const summary = stripHtml(article.summary, 400);
  const tagList = site.hashtags?.length ? site.hashtags : article.tags || [];
  const tagsAll = formatHashtags(tagList, 3);
  const tagsOne = formatHashtags(tagList, 1);
  const hook = truncateAt(title, 90);
  const gist = firstSentences(summary || title, 150);

  return {
    hook,
    bsky: compose(`New on ${siteName}: ${title}\n\n${gist}`, url, tagsOne, 300),
    mastodon: compose(`${title}\n\n${gist}`, url, tagsAll, 500),
    telegram: compose(`📌 ${title}\n\n${gist}`, url, "", 1024),
    discord: compose(`${title} — ${gist}`, url, "", 400),
    facebook_page: compose(`${title}\n\n${gist}\n\nRead it here 👇`, url, tagsAll, 1200),
    linkedin: compose(`${title}\n\n${gist}\n\nThe part we keep coming back to:`, url, tagsAll, 1300),
    x: compose(title, url, tagsOne, 280),
    threads: compose(`${title}\n\n${gist}`, url, "", 500),
    reddit_title: truncateAt(title, 290),
    reddit_body: truncateAt(
      `${gist}\n\nWe wrote this up on our own site (${siteName}), sharing in case it is useful: ${url}\n\nHappy to answer questions in the comments.`,
      900
    ),
    devto_title: truncateAt(title, 95),
    devto_description: truncateAt(gist, 135),
    pinterest: compose(`${title} — ${gist}`, url, tagsOne, 480),
    hashtags: tagList.map((t) => String(t).replace(/^#/, "")).slice(0, 4),
  };
}

export function applySafetyBudgets(copy: Partial<CopyDeck>, article: Article): CopyDeck {
  const budgets: Record<Exclude<keyof CopyDeck, "hashtags">, number> = {
    hook: 90,
    bsky: 300,
    mastodon: 500,
    telegram: 1024,
    discord: 400,
    facebook_page: 2000,
    linkedin: 1300,
    x: 280,
    threads: 500,
    reddit_title: 300,
    reddit_body: 1000,
    devto_title: 100,
    devto_description: 140,
    pinterest: 500,
  };

  const titleOnlyKeys = new Set(["reddit_title", "devto_title", "devto_description", "hook"]);
  const out: Record<string, unknown> = { ...copy };
  if (!String(out.pinterest || "").trim() && String(out.facebook_page || "").trim()) {
    out.pinterest = String(out.facebook_page);
  }

  for (const [k, limit] of Object.entries(budgets)) {
    const val = String(out[k] || "").trim();
    if (titleOnlyKeys.has(k)) {
      out[k] = truncateAt(val || article.title, limit);
    } else if (val && !val.includes(article.url)) {
      out[k] = truncateAt(`${val}\n\n${article.url}`, limit);
    } else {
      out[k] = truncateAt(val || article.url, limit);
    }
  }

  const rawTags = Array.isArray(copy.hashtags) ? copy.hashtags : [];
  out.hashtags = rawTags.map((t) => String(t).replace(/^#/, "")).filter(Boolean).slice(0, 4);
  return out as unknown as CopyDeck;
}

export async function writeCopy(
  article: Article,
  aiSettings: AiSettings,
  site: SiteConfig
): Promise<{ copy: CopyDeck; writerUsed: "gemini" | "template" }> {
  if (aiSettings.enabled) {
    if (!hasGeminiKeyConfigured()) {
      throw new Error(
        "GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in the runtime environment/Secrets or turn off AI Copy Writer in Writer & Media to use the rule-based formatter."
      );
    }
    const generated = await generateWithGemini(article, aiSettings, site);
    if (generated) {
      return {
        copy: applySafetyBudgets(generated, article),
        writerUsed: "gemini",
      };
    }
  }
  return {
    copy: applySafetyBudgets(templateDeck(article, site), article),
    writerUsed: "template",
  };
}

export function hasGeminiKeyConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || "").trim());
}
