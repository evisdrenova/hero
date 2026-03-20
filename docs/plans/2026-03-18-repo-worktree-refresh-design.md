# Repo Worktree Refresh Design

## Summary

Add a refresh control to each repo row in the sidebar so users can manually reload newly created worktrees for that repo without relying on passive query invalidation.

## Scope

- Add one refresh button per repo row in the repository sidebar.
- Show a spinner only on the repo row that initiated the refresh.
- Reuse the existing repos query rather than adding a new backend command.
- Surface refresh failures inline in the sidebar using the existing lightweight error pattern.

## Approach

The frontend currently loads repos and worktrees through a single React Query call, `useReposQuery()`, which invokes the Tauri command `list_repos`. There is no existing single-repo refresh endpoint, so the button will be scoped per repo in the UI while triggering a `refetch()` of the shared repos query underneath.

To keep the UI behavior explicit and testable with the existing Node test runner, the sidebar will use a small pure helper that determines whether a given repo row is currently refreshing. The component will track `refreshingRepoPath` locally, disable the clicked row's refresh button while the query is in flight, and render a spinner for that row only.

## UX

- The refresh button sits on the repo row near the unregister button.
- On click, only that row shows loading treatment.
- Expanded/collapsed state remains path-based and should survive refresh.
- If refresh fails, the sidebar shows a dismissible inline error message.

## Testing

- Add a focused unit test for the per-row refresh-state helper.
- Run the targeted test, the full Node test suite, and the production build.
