// FiscalAI Boardroom — one Steward session per Etsy order number.
// Session = one full brief, then open conversation with Steward until the session window closes.
import { getStore } from "@netlify/blobs";

const MODEL = process.env.STEWARD_MODEL || "claude-haiku-5-5";
const SESSION_MINUTES = Number(process.env.SESSION_MINUTES || 60);
const WINDOW_MS = SESSION_MINUTES * 60 * 1000;
const SAFETY_CAP = Number(process.env.QUESTION_SAFETY_CAP || 60); // silent spend guard, not advertised
const DAILY_BRIEF_CAP = Number(process.env.DAILY_BRIEF_CAP || 60);
const MAX_WORKBOOK_CHARS = 24000;

const SYSTEM = `You are Steward, the AI CFO behind FiscalAI, founded by Sarah M. Gordon.
You are seated at the Boardroom table with an independent earner or small-business owner who has just shared their completed FiscalAI 13-Week Variable Income Forecast.

Personality: supportive, encouraging, calm, optimistic and quietly proud when you find something useful. Never robotic, cold, alarmist or arrogant. Speak in the first person, in plain English. Your promise is making financial complexity feel manageable.

Work only from the workbook data provided. Never invent numbers. If a figure is missing or looks like untouched sample data, say so plainly and explain what to update.

THE BRIEF (first response) uses exactly these sections, as markdown "## " headings:
## Your Position Today
Opening cash, buffer, tax reserve rate and pay target, in two or three sentences.
## What Is Working
The good news, with specific weeks and dollar figures.
## Weeks to Watch
Every Famine week and any week where ending cash falls below the minimum buffer. Name the week, the date and the gap in dollars.
## Your Opportunity
The single highest-leverage move visible in the numbers.
## Recommended Actions
Three to five prioritized, concrete actions, numbered, each tied to a week or figure.
Close with one warm sentence, then ask: "What questions do you have for me?"

FOLLOW-UPS: answer directly in 1 to 4 short paragraphs or a short list, grounded in their figures. End by inviting another question only if they have follow-ups left.

Boundaries: This is planning analysis, not tax, legal or investment advice; for tax amounts point them to a qualified tax professional. Never ask for or repeat bank or card account numbers, Social Security numbers or passwords. Stay on their cash flow and business finances. Keep the brief under 550 words. Format money as $1,234.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function callClaude(messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM, messages }),
  });
  if (!r.ok) throw new Error(`Model error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error(`Empty reply: stop=${d.stop_reason} blocks=${(d.content || []).map((b) => b.type).join(",")} model=${d.model}`);
  return text;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "The Boardroom is being prepared. Please try again shortly." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const code = String(body.code || "").replace(/\D/g, "");
  if (code.length < 9 || code.length > 12)
    return json(400, { error: "Please enter your Etsy order number (digits only, found in your Etsy purchase receipt)." });

  const allow = (process.env.ORDER_ALLOWLIST || "").split(/[\s,]+/).filter(Boolean);
  if (allow.length && !allow.includes(code))
    return json(403, { error: "We could not match that order number yet. If you just purchased, please try again in a few hours or contact mentor@fiscalai.org." });

  const sessions = getStore({ name: "boardroom-sessions", consistency: "strong" });
  const now = Date.now();
  let s = await sessions.get(code, { type: "json" });

  try {
    if (body.mode === "brief") {
      if (s?.brief) return json(200, { brief: s.brief, history: s.history, expiresAt: s.expires, open: s.expires > now, resumed: true });

      const wb = String(body.workbook || "").slice(0, MAX_WORKBOOK_CHARS);
      if (wb.length < 200) return json(400, { error: "We could not read your forecast. Please upload your completed FiscalAI 13-Week workbook (.xlsx)." });

      const day = new Date().toISOString().slice(0, 10);
      const meta = getStore({ name: "boardroom-meta", consistency: "strong" });
      const count = Number((await meta.get(`briefs-${day}`)) || 0);
      if (count >= DAILY_BRIEF_CAP) return json(429, { error: "The Boardroom is at capacity today. Your session is saved for tomorrow — please return then." });
      await meta.set(`briefs-${day}`, String(count + 1));

      const first = `Here is my completed FiscalAI 13-Week Variable Income Forecast.\n\n${wb}\n\nPlease give me my Boardroom brief.`;
      const brief = await callClaude([{ role: "user", content: first }]);
      s = { created: now, expires: now + WINDOW_MS, workbook: wb, brief, followups: 0, history: [] };
      await sessions.setJSON(code, s);
      return json(200, { brief, history: [], expiresAt: s.expires, open: true });
    }

    if (body.mode === "ask") {
      if (!s?.brief) return json(400, { error: "Please start your session by uploading your forecast." });
      if (now > s.expires) return json(403, { error: "This Boardroom session has closed. Thank you for taking your seat at the table." });
      if (s.followups >= SAFETY_CAP) return json(403, { error: "We have covered a great deal today. This Boardroom session is now complete. Thank you for taking your seat at the table." });
      const q = String(body.question || "").trim().slice(0, 1200);
      if (!q) return json(400, { error: "Please type your question." });

      const messages = [
        { role: "user", content: `Here is my completed FiscalAI 13-Week Variable Income Forecast.\n\n${s.workbook}\n\nPlease give me my Boardroom brief.` },
        { role: "assistant", content: s.brief },
      ];
      for (const h of s.history) messages.push({ role: "user", content: h.q }, { role: "assistant", content: h.a });
      const minsLeft = Math.max(0, Math.round((s.expires - now) / 60000));
      messages.push({ role: "user", content: `${q}\n\n(Session time remaining: about ${minsLeft} minutes.)` });

      const answer = await callClaude(messages);
      s.history.push({ q, a: answer });
      s.followups += 1;
      await sessions.setJSON(code, s);
      return json(200, { answer, expiresAt: s.expires, open: true });
    }

    return json(400, { error: "Unknown request." });
  } catch (e) {
    console.error(e);
    return json(502, { error: "Steward stepped away for a moment. Please try again.", detail: process.env.BOARDROOM_DEBUG ? String(e.message) : undefined });
  }
};

export const config = { path: "/api/boardroom" };
