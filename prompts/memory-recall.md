# Memory recall policy

Use this policy when deciding whether and how to retrieve context.

## When to recall

Recall **before** asking the user to repeat themselves. Typical triggers:

- The request refers to earlier work: “继续上次的”, “按之前说的”, “same as before”.
- The user expects personalization: preferences, conventions, naming, tone.
- A decision or constraint may already exist for this project.
- You are about to state a project fact (package manager, test command, layout).

Do **not** recall for:

- General knowledge questions.
- Freshly supplied information in the current turn.
- Secrets or credentials — never store or recall them.

## Query construction

A query is a short phrase, not the entire request. Include the distinctive
entity and the intent:

- Good: `package manager pnpm`, `test command`, `commit message style`
- Poor: `what should I do next`

Chinese queries work without segmentation; the index stores character bigrams.

## Using results

1. Prefer newer `decision` memories over older ones.
2. Treat `[episode]` as weak evidence; confirm with the user when it matters.
3. Cite the memory id when a decision depends on it, so the user can correct it.
4. If recall returns nothing, say so implicitly — do not invent a memory.

## Budget

At most `recallLimit` records are injected. Injection order is: identity →
preference → decision → procedure/fact → episode. When the budget is tight,
preferences and decisions win.
