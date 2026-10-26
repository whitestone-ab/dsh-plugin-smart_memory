# Memory evaluation

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

To extend the suite, add cases here first, then add a matching unit test. Keep
cases small, deterministic, and independent of wall-clock time (use fixed
`expiresAt` dates in the past).
