# FiscalAI Boardroom (fiscalai.org/faisteward)

Static page: public/faisteward/index.html
Serverless function: netlify/functions/boardroom.mjs  (route: /api/boardroom)
Session storage: Netlify Blobs (automatic, no setup)

## Environment variables (Netlify > Site configuration > Environment variables)
- ANTHROPIC_API_KEY   required. Paste here only, never in chat or code.
- STEWARD_MODEL       optional, default claude-haiku-5-5
- DAILY_BRIEF_CAP     optional, default 60 new briefs per day
- ORDER_ALLOWLIST     optional. Comma-separated Etsy order numbers. When set, only these codes open a session.

## Session rules
One session per order number: one brief, then open Q&A for SESSION_MINUTES (default 120). QUESTION_SAFETY_CAP (default 60) is a silent spend guard.

## Connect to fiscalai.org (main site _redirects file)
/faisteward      https://BOARDROOM-SITE.netlify.app/faisteward/      200
/faisteward/*    https://BOARDROOM-SITE.netlify.app/faisteward/:splat 200
/api/boardroom   https://BOARDROOM-SITE.netlify.app/api/boardroom     200
