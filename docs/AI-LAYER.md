# لایهٔ مدل زبانی — the model layer (wave 6)

This is the optional second stage that `ASSISTANT.md` promised: a language model behind
`provider.ts`, used only where a rule is weakest — regulations Q&A, résumés, open text, and the
prose of minutes and decrees. It sits *on top of* the deterministic engines, never under them.

The line the whole layer is built around: **the model writes text; it does not decide anything.**
No score, no ranking, no stage change, no rejection, no number that a labour inspector would ask us
to justify. Every number that reaches a screen is computed from our own rows.

## Where it lives

| File | Role |
| --- | --- |
| `app/lib/ai/prompt-kit.ts` | Pure: redaction, the six prompt builders, the three validators. No Prisma, no `fetch`, no React — this is the half that is tested. |
| `app/lib/ai/provider.ts` | Transport. `deepseekConfig(env)`, `deepseekProvider`, `offlineProvider`, `activeProvider`. The only place that leaves the process. |
| `app/lib/ai/run.ts` | Orchestrator: redact → quota → call → validate → ledger. Never throws. |
| `app/lib/ai/hr-ai.ts` | Use cases with permissions and Prisma: CV, survey, feedback, minute, decree, status. |
| `app/lib/hr-assistant.ts` → `modelStage()` | AI-05 Stage 2: cited answer with Stage 1 as fallback. |
| `app/lib/hr-service.ts` → resource `ai` | `readHr("ai")` returns status + last insights; `writeHr("ai")` dispatches `cv \| apply-cv \| survey \| feedback \| minute \| decree`. |
| `app/components/cv-dialog.tsx`, `insight-panel.tsx`, `ai-client.ts` | The three interfaces. Draft buttons live inside `meeting-forms.tsx` and `hokm-forms.tsx`. |
| `tests/ai-layer.test.cjs` | 28 tests over the pure half plus provider configuration. |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | — | Server-side only. Absent ⇒ `offline` provider. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Any OpenAI-compatible host — in-country host or a local vLLM/Ollama. |
| `DEEPSEEK_MODEL` | `deepseek-chat` | |
| `DEEPSEEK_TIMEOUT_MS` | `30000` | Clamped to 3s–120s; a malformed value falls back to the default. |
| `AI_DISABLED` | — | `1`/`true` switches the model off even with a key present. |

Nothing in the client knows any of this. `readHr("ai")` reports `{configured, provider, model, used,
limit, remaining}`, and the UI only ever says «مدل در دسترس نیست» — it never exposes the endpoint.

**Data residency** is a configuration decision here, not a code change: point `DEEPSEEK_BASE_URL` at
the in-country host or the local model. That was open question §8.5 in `AI-ROADMAP.md`; the shape of
the answer is that residency never requires touching a caller.

The deployment needs two optional packages for file upload — `npm i mammoth pdfjs-dist` (host only;
the sandbox cannot reach the registry). Without them, `optionalModule()` returns null, the API
answers with a Persian «text unsupported» message, and the paste box still works. They are imported
by variable name (`await import(name)`) so `tsc` never has to resolve them.

## The guardrails, and what enforces each

| Guardrail | Enforced in | Failure mode it prevents |
| --- | --- | --- |
| Redaction before egress | `redactSensitive` in `runAi`, applied to *both* system and prompt | National id, IBAN, card, a labelled account, and every 4+ digit number on a money line leave the process. The sentence survives; «حقوق پرداخت نشده بود» is itself a survey finding. |
| Prompt never stored | `promptHash` (sha256 of system + prompt) is the only column | The ledger can match a disputed answer to its question without hoarding CVs. |
| Quota | `aiQuota` counts `HrAiCall` for the user in the last hour; `RATE_LIMIT_PER_HOUR = 30` | A stuck dialog cannot burn a month's budget. |
| Output is not an answer until validated | `validate` callback; `null` ⇒ `INVALID` row and the caller falls back | A malformed JSON response never reaches a textarea. |
| Ledger never breaks the path | `log()` is wrapped in try/catch | A missing table (fresh clone, no migrate) degrades to "no audit", not "no feature". |
| Nothing throws | every branch of `runAi` returns an outcome | Callers have exactly one fallback to write, and it is Stage 1 / the manual form. |

Redaction is deliberately *minimal*, not maximal: over-redacting a CV leaves the model nothing to
extract, and over-redacting survey text deletes the complaint. The list is the identity-and-money
set, and the test file pins both directions — `1398` and `2500` on an ordinary line must survive.

## The six features

**Assistant (AI-05 Stage 2).** `modelStage()` takes the top four documents Stage 1 already ranked and
builds `assistantPrompt`. The answer is accepted only if it carries at least one `[#n]` inside the
range of sources offered; `NONE`, empty, or citation-free text returns `null` and the deterministic
answer is shown instead. In this product an uncited answer is indistinguishable from a fabricated
one, so it is treated as one. `AssistantAnswer.kind` gained `"model"`, `citations` carry the source
id/title/href, and the panel renders «منابع ارجاع‌شده» as openable links.

**Résumé (`analyzeCv` / `applyCv`).** Text arrives either as a PDF/DOCX upload (max 8 MB, extracted
to ≤30 000 chars, minimum 80 usable chars) or pasted. The text is saved to `HrCandidate.cvText`
*before* the model is called, so an outage still leaves the recruiter something to read. The draft
(`education`, `experienceYears`, `skills`, `matches`, `gaps`, `questions`) is stored as a proposal.
`applyCv` can write **only** `education` and `experienceYears`, only for a candidate that has a
proposal and is not `HIRED`/`REJECTED`, and never touches `stage`, `decisionNote` or the reviewer's
assessment. Both endpoints require `hr:recruitment:manage`.

**Survey text (`surveyInsight`).** Collects up to 60 TEXT answers of ≥8 chars from
`HrSurveyResponse`, needs at least 3, and gives each one an id `p1…pN`. The model returns theme
labels plus quote **ids**; `validateInsight` drops unknown ids, keeps a quote in only one theme,
caps at 6 themes × 4 quotes, and copies the quote text from our rows — the model cannot put words in
a respondent's mouth. `count` is `picked.length`, never a number the model wrote.

**«صدای من» (`feedbackInsight`).** Same pipeline over `HrFeedback` (default 90 days, capped 200
rows, ids `f<last 8 of id>`), with the prompt forbidding sender names and per-person attribution.
The aggregate view shows themes and verbatim messages, never who wrote them.

Both insight paths write the last reading to `HrTextInsight`, so two managers opening the same survey
see the same analysis and `readHr("ai")` can show it without spending another call.

**Minute drafting (`draftMinute`).** Two entry paths, because both are real: an existing
`HrMeetingMinute` (tenant-checked, anything not `DRAFT` refused), or the unsaved form —
meeting name, date, location, present attendees, and non-empty resolutions (at least one required),
each field length-capped. Output is 3–5 sentences of flowing prose, capped at 8000 chars, appended
into the summary textarea. The user edits and saves it like any typing; the signature chain is
untouched.

**Decree drafting (`draftDecree`).** Same two paths via `hokmSheet`; `SIGNED`, `NOTIFIED` and
`CANCELLED` are refused. The prompt receives the items (label, letter, amount) so the model knows
*which* item it is describing — and `runAi` redacts every amount on those lines before they leave.
The decree's 2–4 sentence «علت صدور» comes back capped at 2000 chars and lands in a textarea.

## What is *not* here, on purpose

Salary, 9-box placement, promotion readiness, discipline severity, file-audit severity, fatigue,
shift assignment and contract termination stay deterministic and are labelled as such in the UI. A
fatigue score that ends a person's night shift must be reproducible without a network, a model
version, or a sampling temperature. `AI-01` (open-place filling) lives in **shiftwise**, not here.

## Verification

```
node --test tests/ai-layer.test.cjs     # 28 tests, no network, no database
```

On the host, once: `npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`, then
`npm run test:ai` (98 tests across the rule engines and this layer). To try it for real, set
`DEEPSEEK_API_KEY` for one command and unset it afterwards — the same discipline `shiftwise/README`
uses for `SUPERADMIN_PASSWORD`; the key never enters the repo or a config file.

The sandbox cannot do the first step: without `prisma generate` the generated client does not know
`HrAiCall`, `HrTextInsight` or the four new `HrCandidate` fields, so those are the only type errors
`tsc` reports there. Everything else type-checks.
