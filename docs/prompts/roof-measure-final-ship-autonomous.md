# Roof measure 2.5D — autonomous final ship prompt

Use this when you want **one orchestrator + parallel agents** to run overnight without stopping for approvals.

**Prereq (one-time, ~2 min):** see [Autonomy setup](#autonomy-setup) below.

---

## Autonomy setup (do once)

### Cursor IDE (Agent chat)

1. Open workspace **`/Users/nathanhall/arx-internal-crm`** (not home — sandbox boundary matters).
2. **Cursor Settings → Agents → Auto-Run**
   - Set **Auto-Run Mode** → **Auto-Run in Sandbox** (commands in workspace run without prompts).
3. Optional stricter control: **Use Allowlist** + enable **Legacy Terminal Tool** — then `~/.cursor/permissions.json` applies.
4. Enable **Multitask Mode** if available — subagents run in background without blocking you.
5. When a subagent finishes, read its summary; only intervene on **NO-GO**.

### Permissions file (already on this machine)

`~/.cursor/permissions.json` — auto-runs roof-measure gates, git, gh, and MCP browser/app-control without prompts.

### CLI agents (optional)

Project override: `.cursor/cli.json` — `approvalMode: unrestricted` for headless `agent -p` runs in this repo.

---

## AUTONOMY MANDATE (prepend to every agent)

```text
AUTONOMY — DO NOT STOP FOR APPROVALS

You have pre-authorization for this ship window. The human opted out of per-step approval.

DO:
- Run all gates, tests, git, gh, npm, browser QA, and MCP tools without asking permission
- Use Shell with required_permissions: ["all"] when sandbox blocks network/git (push, fetch, prod URLs, npm install)
- Spawn subagents in parallel (background) and keep working until GO/NO-GO memo is written
- Fix P0 blockers only; minimal diff; re-run prelaunch after each fix
- Commit + push P0 fixes without asking (message: fix(roof): …)
- File docs/roof-measure-qa-YYYY-MM-DD-final.md with evidence

DO NOT:
- AskQuestion or "should I proceed?" — proceed unless a NO-GO trigger fires
- Ask the user to run commands — you run them
- Enable USE_PLANE_INTERSECTION_LF in prod
- Ship speculative features or doc rewrites

STOP ONLY FOR (escalate in GO/NO-GO memo):
- Login / MFA / captcha on prod CRM
- Missing API keys or env vars you cannot read
- Test failure you cannot fix with certainty in one minimal patch
- Destructive git (force push, hard reset)

If Cursor shows "Waiting for approval" with no dialog: send "continue" once (known UI bug).
```

---

## Master ship prompt (paste after AUTONOMY MANDATE)

```text
You are Head of Dev for ARX roof measure 2.5D final ship. Workspace: /Users/nathanhall/arx-internal-crm — move_agent_to_root first.

Prod: https://arx-internal-crm.vercel.app/tools/roof-measure
Golden addresses: 1361 Kison Ct NW Concord NC; 304 Greenway Dr (case study)

Read: docs/roof-measure-in-house-capability-prompt.md, docs/roof-measure-launch-checklist.md, docs/roof-measure-greenway-case-study.md

Spawn in parallel (background, no user checkpoints):
- Agent A: prelaunch + build + deploy SHA
- Agent B: CRM collateral audit (measurements, builder, webhooks, ops)
- Agent C: 2.5D wiring audit (slopedAreaSqft, reload, pitch_source, flag off)
- Agent D: desire paths 1–6 (logic)
- Agent D-UI: browser prod QA + fill launch checklist → docs/roof-measure-qa-2026-05-28-final.md
- Agent E: prod detect-roof smoke (Concord facets > 0)
- Agent F: regression tests + Greenway frozen math

GO only if ALL gates G1–G11 pass (see prior ship prompt). Plane LF flag stays OFF.

Output: GO/NO-GO memo with SHA, gate table, shipped vs deferred, P1 follow-ups.
Do not ask the user anything until the memo is ready unless STOP conditions above apply.
```

---

## What still needs you (cannot automate)

| Item | Why |
|------|-----|
| CRM login on prod | Session / MFA |
| Ops sign-off row in launch checklist | Human accountability |
| First-time "Allow" on a **new** command not in allowlist | Add via "Add to allowlist" once, then never again |

Everything else should run hands-off.
