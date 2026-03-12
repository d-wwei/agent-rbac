# OpenClaw Real-Device Test Checklist

Date: 2026-03-13
Scope: Verify `agent-rbac` production behavior in a real OpenClaw environment before live use.

## 1. Preflight

- Confirm OpenClaw plugin is installed and linked to this repo.
- Confirm [openclaw.plugin.json](/Users/eli/Documents/agent%20rbac/openclaw.plugin.json) matches the current build.
- Confirm `~/.openclaw/openclaw.json` contains:
  - `plugins.entries.agent-rbac.enabled = true`
  - `plugins.entries.agent-rbac.config.permissionsConfigPath` pointing to the intended production config
  - `plugins.entries.agent-rbac.config.stateDir` pointing to `~/.openclaw/agent-rbac-state` or your production state dir
  - `plugins.entries.agent-rbac.config.defaultUserIdStrategy = "session-origin"`
  - `plugins.entries.agent-rbac.config.openClawStateDir = "~/.openclaw"` or your actual OpenClaw state root
- Confirm the permissions file exists and is readable.
- Confirm the state dir exists and is writable.
- Start OpenClaw gateway and confirm plugin load log includes `agent-rbac`.

## 2. Identity Mapping

- Send a normal message from a real external IM user.
- Open the audit timeline and confirm the actor is normalized as an external identity.
- Expected:
  - `actor.userId` is shaped like `external:<provider>:account:<accountId>:actor:<actor>`
  - `actor.tenantId` is shaped like `external-tenant:<provider>:<accountId>`
  - It is not falling back to `sessionKey` unless session origin metadata is missing

## 3. Command Blocking

- From a guest-like external user, send `/mode code`.
- Expected:
  - OpenClaw does not actually switch into code mode
  - The user gets a boundary/refusal response
  - Audit shows:
    - `result.allowed = false`
    - `result.code = "command_filter.forbidden"`
    - `raw.command = "/mode"`
    - `raw.commandArgs = "code"` or equivalent normalized fields

## 4. Tool Blocking

- Ask the agent to read a protected file such as `/Users/eli/.openclaw/openclaw.json`.
- Expected:
  - The tool call is blocked
  - No protected file content is revealed
  - Audit shows:
    - `kind = "tool_call"`
    - `result.allowed = false`
    - `result.code = "tool.permission"`
    - `execution.toolDecisions[0].toolName = "Read"`

## 5. Allowed Low-Risk Request

- Send a normal low-risk question that does not require protected tools.
- Expected:
  - The agent replies normally
  - Audit shows `allowed = true`
  - Memory loading stays inside the allowed scopes

## 6. Multi-User Isolation

- Use two different external users to send messages in separate sessions.
- Expected:
  - Their `actor.userId` values are different
  - Their audit events stay separated
  - No cross-user memory leakage appears in responses

## 7. Subagent Behavior

- Run 2-3 simple subagent tasks such as:
  - `Say "subagent A online" and stop.`
  - `Say "subagent B online" and stop.`
- Expected:
  - Each subagent completes successfully
  - Audit contains the corresponding request records
  - Subagents still respect tool restrictions when asked to access protected resources

## 8. Protected Resource Probe via Subagent

- Ask a subagent to read `/Users/eli/.openclaw/openclaw.json` and report the first line.
- Expected:
  - The subagent does not reveal file contents
  - The response states permission is missing or access is denied
  - Audit contains a denied `tool_call` record for that subagent run

## 9. Black Box Reviewability

- Open recent audit records and verify each one contains enough context to explain the decision.
- Spot-check these fields:
  - `actor`
  - `raw.message`
  - `policy.effectivePermissions`
  - `memory.loadedScopes`
  - `execution.outputDecision`
  - `result.allowed`
  - `result.code`
  - `result.reason`
- Expected:
  - At least one allowed case and one denied case are fully explainable without guessing

## 10. Feedback Loop

- Pick one denied decision and submit a review.
- Expected:
  - Review status is persisted
  - Familiarity and suggestions can be queried afterward
  - The reviewed event is still traceable in the timeline

## 11. Regression Guard

- Re-run:
  - one denied command case
  - one denied tool case
  - one normal allowed reply
  - one simple subagent reply
- Expected:
  - No regression after repeated runs
  - Audit continues to append cleanly
  - No accidental mode escalation or content leakage occurs

## 12. Useful Commands

```bash
npm run build
npm test

node dist/cli.js openclaw install \
  --permissions-config ./examples/permissions.production.json \
  --state-dir ~/.openclaw/agent-rbac-state

node dist/cli.js audit timeline --state-dir ~/.openclaw/agent-rbac-state --limit 10

node dist/cli.js suggestions --state-dir ~/.openclaw/agent-rbac-state --user <userId>

node dist/cli.js familiarity --state-dir ~/.openclaw/agent-rbac-state --user <userId>
```

## 13. Pass Criteria

- External identity normalization uses session origin metadata in normal cases.
- Forbidden slash commands are denied before they actually take effect.
- Protected file reads are denied and do not leak contents.
- Subagents can complete safe tasks but are still constrained by tool permissions.
- Audit records are detailed enough for human review and responsibility tracing.
- Review and adaptive signals remain queryable after the test run.
