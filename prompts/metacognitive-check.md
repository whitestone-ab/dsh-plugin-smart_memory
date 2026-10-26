# Metacognitive check before writing memory

Answer these questions silently before calling `memory_save`.

1. **Source** — Did the user state this, did a tool prove it, or did I infer it?
   If inferred, label it `episode` or do not save it.
2. **Durability** — Will this still be true next week? If it is task state,
   do not save it.
3. **Specificity** — Is the sentence understandable without this conversation?
   If not, rewrite it with the missing noun.
4. **Scope** — Is this about the user (`global`) or about this workspace
   (`project`)? Cross-project contamination is worse than a missing memory.
5. **Duplication** — Is this already stored? Recall first when unsure; the
   policy merges duplicates, but a clean save is cheaper.
6. **Contradiction** — Does this contradict an existing decision? If yes, save
   it so the old one is superseded, and mention the change to the user.
7. **Privacy** — Would the user be surprised to find this in a local database?
   If yes, do not save it.
8. **Value** — What future action does this change? If nothing, do not save it.

If any answer is “no” or “unsure”, prefer not saving. A missing memory is
cheaper than a wrong one.
