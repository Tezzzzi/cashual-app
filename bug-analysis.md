# Work Expense Filtering — Complete Bug Analysis

## Symptom
When filtering by Work company "DM" in Reports, personal groceries show up.

## Root Causes Found

### Bug 1: `businessGroupId` filter without `isWork=true` guard in DB queries
In `getTransactions`, `getReportSummary`, and `getReportByCategory`, the
`businessGroupId` filter is applied independently:
```
if (opts?.businessGroupId) conditions.push(eq(transactions.businessGroupId, opts.businessGroupId));
```
This means if ANY transaction has `businessGroupId` set but `isWork=false`
(which is possible — schema has no constraint), it would be included when
filtering by businessGroupId alone.

However, the frontend always sends `isWork=true` alongside `businessGroupId`,
so this alone shouldn't cause the leak...

### Bug 2 (THE REAL BUG): Reports "work" filter does NOT exclude non-work transactions
When `budgetFilter === "work"` in Reports.tsx, the frontend sends:
```
{ isWork: true }  // or { isWork: true, businessGroupId: N }
```

In the DB, the user-scope block falls to `else → userId=X`. Then `isWork=true`
is added. The query becomes: `WHERE userId=X AND isWork=true`.

**BUT** — the `businessGroupId` filter line is:
```
if (opts?.businessGroupId) conditions.push(...)
```
This uses a TRUTHY check. If `businessGroupId` is `0` or `undefined`, it's
skipped. That's fine.

**THE ACTUAL PROBLEM**: When the user selects a specific company in the
dropdown, `businessGroupFilter` is set to that company's ID string (e.g. "2").
Then `parseInt("2")` = 2. This is correct.

But when `businessGroupFilter === "all"`, NO `businessGroupId` is sent.
The query becomes just: `WHERE userId=X AND isWork=true`.

This SHOULD only return work transactions. So if groceries are showing up,
it means those grocery transactions have `isWork=true` in the database!

### Bug 3 (MOST LIKELY): Data integrity — transactions with wrong isWork flag
The voice parser can set `isWork=true` based on LLM detection of work context.
If the LLM incorrectly detects "work" context for a personal grocery purchase,
the transaction gets saved with `isWork=true`.

BUT the user says filtering by company "DM" shows groceries. If filtering by
a SPECIFIC company shows non-work items, then either:
a) Those grocery transactions have `businessGroupId` matching DM's group ID
b) The `businessGroupId` filter is not actually being applied

### Bug 4 (CONFIRMED): The `businessGroupId` filter check is only truthy
```
if (opts?.businessGroupId) conditions.push(...)
```
If `businessGroupId` is `0`, this would be falsy and skip the filter.
But auto-increment IDs start at 1, so this shouldn't be an issue.

## Re-examining the full chain for "Work + DM" filter:

1. Frontend Reports.tsx: `budgetFilter="work"`, `businessGroupFilter="2"` (DM's ID)
2. summaryParams = `{ isWork: true, businessGroupId: 2 }`
3. Router: Zod schema now accepts these (after our first fix) ✅
4. Router passes `{ ...input, userIds }` to `getReportSummary`
5. DB: conditions = [userId=X, isWork=true, businessGroupId=2]
6. Query: `WHERE userId=X AND isWork=true AND businessGroupId=2`

This should be correct... UNLESS the router is still stripping the fields.

## WAIT — Let me check if the previous fix was actually deployed!
The push was to `cashual-app` repo. Let me verify the current code state.
