# Memory evaluation

> - **Document type**: evaluation notes
> - **Created**: 2026-10-26 12:49 (UTC+8)
> - **Last updated**: 2026-10-26 16:05 (UTC+8)
> - **Applies to**: `HEAD f9b226c` · `smart-memory-dsh 0.1.0`
> - **Status**: active

`cases.json` is a small behavioural suite for retrieval and write policies. It is
intentionally data-only so it can be replayed against any implementation.

## Case format

| Field | Meaning |
|---|---|
| `seed` | Memory records to insert before the query. `id` is fixed for assertions. |
| `query` | Text passed to recall. Empty means “most important memories”. |
| `expectIds` | Ids that must appear in the result. |
| `forbidIds` | Ids that must not appear (optional). |

## Running

The unit and integration suites already cover the same rules with assertions:

```sh
pnpm test
```

Integration files write to the OS temp directory, so the runner needs a writable
`TMPDIR` / `%TEMP%`.

## Extending

To extend the suite, add cases here first, then add a matching unit test. Keep
cases small, deterministic, and independent of wall-clock time (use fixed
`expiresAt` dates in the past).

Project-wide documentation conventions live in
[docs/README.md](../../docs/README.md).
