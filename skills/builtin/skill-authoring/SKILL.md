---
name: skill-authoring
description: Guidance for distilling a repeatable workflow into a reusable Skill (SKILL.md) that you can load later.
when_to_use: The user asks you to "remember", "make a skill", "save this workflow", or you notice yourself performing the same multi-step recipe more than twice within or across sessions.
source: global
---

# Authoring a new Skill

A Skill is a single `SKILL.md` file (plus optional resources) that lives in a directory and captures **a procedure worth reusing**. Skills are indexed into the system prompt by name + description, and loaded in full only when you call `load_skill`.

## When to author a skill

Good candidates:
- **Multi-step recipes** you've run more than twice (e.g. "how to cut a hotfix release in this repo").
- **Non-obvious conventions** embedded in the codebase that a fresh session would miss.
- **Project-specific vocabulary** that repeatedly trips up generic reasoning.

Bad candidates (these belong in memory instead):
- One-off facts about the user or project.
- Single tool invocations with no surrounding process.
- Anything already derivable from reading the current codebase.

## Where to write it

Two scopes exist. Pick one:

| Scope       | Directory                        | Visibility                              |
|-------------|----------------------------------|-----------------------------------------|
| `per-agent` | `<your workspace>/skills/<name>/`| Only this agent loads it                |
| `global`    | `~/.berry-claw/skills/<name>/`   | Every agent in this installation loads it |

Most skills you author on your own should be `per-agent` — they encode **your** accumulated judgement and shouldn't bleed into other agents without review. Promote to global only when a human confirms.

The directory name should be kebab-case and match the `name` frontmatter field.

## Authoring steps

1. **Confirm scope with the user** before writing the first version — "should this live only with me, or should every agent see it?"
2. **Pick a concise name** (kebab-case) that makes sense in a flat index: `setup-local-db`, not `skill-for-db`.
3. **Write the frontmatter**:
   ```yaml
   ---
   name: kebab-case-name
   description: One sentence the agent reads to decide whether to load this skill.
   when_to_use: Trigger phrases or situations (user says "X", or you're about to do Y).
   source: per-agent        # or 'global' if the user approved promotion
   author_agent: <your id>  # optional — auto-filled from the dir if omitted
   ---
   ```
4. **Write the body** as instructions **to your future self**. Use imperative voice ("Run `npm install`"), not passive narration. Keep it under ~300 lines; if it grows larger, split into sub-skills or reference material.
5. **Use `Write`** (for new files) or `Edit` (for updates) — there is no dedicated "create_skill" tool. The file is the source of truth.
6. **Verify** by listing the skills directory, then by calling `load_skill` with the new name in a follow-up turn.

## Update vs. author fresh

If a similar skill already exists, **update it** instead of creating a rival. Duplicate names collide (first wins by the SDK's dedup rule) and the user gets silent divergence.

## What NOT to include

- Secrets, API keys, tokens — the skill is plain text on disk.
- Dynamic state (current branch, current date, current bug list) — put that in memory or fetch fresh.
- Giant verbatim code dumps — link to the file with `path:line`, don't inline it.

## After writing

Tell the user the path you wrote, and remind them that per-agent skills are gated by the `enabledSkills` whitelist in their `agents.json` — they may need to tick a box in the Agents Tab to activate it.
