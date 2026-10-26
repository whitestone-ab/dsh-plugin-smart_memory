# Memory save policy

Save only what will still be true and useful in a future session.

## Save

- **identity** — stable facts about the user (role, expertise, language).
- **preference** — how the user wants work done (tools, style, format).
- **decision** — an explicit choice with a reason (“we use pnpm because …”).
- **procedure** — a repeatable recipe specific to this project.
- **fact** — a durable project fact (layout, commands, constraints).
- **episode** — a notable outcome worth remembering, but weaker than a fact.

## Never save

- Secrets, tokens, passwords, private keys, personal identifiers.
- Transient state: “currently fixing the parser”, “the build is running”.
- Unverified model guesses. If it was not stated or observed, do not save it.
- Duplicates. The save policy merges near-duplicates and supersedes
  contradictions instead of appending a second copy.

## Writing style

- One self-contained sentence; no pronouns that need the conversation.
- Include the reason for decisions, not just the decision.
- Use `subject` / `predicate` / `value` when the memory is structured:
  `package-manager` / `is` / `pnpm`. This makes conflict detection precise.

## Confidence

- Confidence comes from evidence, not from how confident the wording sounds.
- User-stated facts carry the most weight; tool output is next; model inference
  is the weakest and should usually be saved only as an `episode`.

## Conflicts

When a new memory contradicts an existing one, the new one supersedes it and the
old record is archived. Do not “keep both” unless the user asks for history.
