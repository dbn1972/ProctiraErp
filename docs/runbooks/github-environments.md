# GitHub Environments for deploy/release (PRC-H061)

The workflow-side guard is in place: `deploy.yml` and `release.yml` only proceed from a
`workflow_run` whose `event == 'push'` and whose `head_repository.full_name` equals this
repository (enforced and asserted by `tools/scripts/check-runtime-role-gate.test.mjs`).
GitHub repository settings are the second layer and must be configured by a repository
admin — they cannot be set from a workflow file.

## Required settings (Settings → Environments)

| Environment | Required reviewers | Deployment branches and tags | Other |
| --- | --- | --- | --- |
| `production` | at least 1 (release managers team); "Prevent self-review" on | Selected branches: `main` only | Wait timer optional |
| `staging` | optional | Selected branches: `develop` (and `main` if staging deploys from main) | — |

Also: Settings → Actions → General → "Fork pull request workflows from outside
collaborators" = *Require approval for all outside collaborators*.

## CLI (admin token with `repo` scope)

```bash
gh api -X PUT repos/dbn1972/ProctiraErp/environments/production --input - <<'JSON'
{"reviewers":[{"type":"Team","id":<RELEASE_TEAM_ID>}],"prevent_self_review":true,
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/dbn1972/ProctiraErp/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
gh api -X PUT repos/dbn1972/ProctiraErp/environments/staging --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/dbn1972/ProctiraErp/environments/staging/deployment-branch-policies \
  -f name=develop -f type=branch
```

## Live negative test

From a fork, open a PR whose head branch is named `main`, let CI pass, and confirm the
Deploy and Release runs show every job skipped/failed at `ci-gate` with no build or
migrate job started. Record the run URLs in the release evidence.
