# Contributing

How we branch, review and deploy this repo. Please read this before opening a PR.

## Branches

| Branch | Purpose | Deploys to |
|---|---|---|
| `prod` | Live production code | push to `prod` runs `deploy-prod.yml` |
| `UAT` | User acceptance testing (client sign-off) | push to `UAT` runs `deploy-uat.yml` |
| `main` | Legacy. Out of date; do not branch from it or merge into it | nothing |

`prod` and `UAT` are both long-lived. Each one only receives code through pull requests. Nobody pushes to them directly.

## Making a change

Most changes need to land in **both** environments. Use a pair of branches, one per base:

| Branch | Cut from | PR into |
|---|---|---|
| `hotfix/<short-name>-prod` | `prod` | `prod` |
| `fix/<short-name>-uat` | `UAT` | `UAT` |

- Make the change on one branch, then `git cherry-pick` it onto the other.
- For a new feature, use `feature/<short-name>-prod` and `feature/<short-name>-uat`.
- If the change is UAT-only for now (client testing first), open just the `-uat` PR and the `-prod` one once it's approved.
- PRs are squash-merged. Delete the branch right after merging.
- Use the GitHub CLI: `gh pr create --base prod` (or `--base UAT`).

### Commit messages
Use `type(scope): summary`, for example `fix(reports): include cancellations in summary`. Types: `feat`, `fix`, `chore`, `docs`, `refactor`.
Never push throwaway commits like `t` or `test` to `prod` or `UAT`. Squash them before merging.

## Keeping prod and UAT in sync
Before every release, check that the two contain the same code apart from intended UAT-only work:

```bash
git fetch origin
git diff --stat origin/prod origin/UAT
```

Because PRs are squash-merged, `git log prod..UAT` always shows "differences". Compare file contents with `git diff`, not commit history.

## One-off scripts
Scripts in `src/seeds/` run once, by hand, for data fixes or migrations. When the job is done, delete the script rather than leaving it on a branch.

## Secrets
Never commit `.env`. Copy `.env.example` and fill it locally. Deploy secrets live in GitHub Actions secrets.

## Parked work
`wip/*` branches hold unfinished work that was set aside on purpose. Don't merge them without talking to the owner.
