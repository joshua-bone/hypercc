# Repo Working Agreements

- After completing requested changes, commit and push them unless the user explicitly says not to.
- Cover every code change with automated tests when practical, and add or update tests for the behavior touched in the same change.
- Before every commit and push, run the relevant automated tests and verification commands locally and do not commit or push if they fail.

## GitHub HTTPS

- This machine uses HTTPS for GitHub remotes and clones. Keep GitHub remotes on `https://github.com/...` and do not switch them back to SSH unless the user explicitly asks.
- Prefer GitHub CLI auth for GitHub Git operations. Check `gh auth status`, and if GitHub credentials need wiring, run `gh auth setup-git`.
- For new GitHub clones, use HTTPS URLs or `gh repo clone` with GitHub CLI configured for HTTPS.
- Leave non-GitHub remotes unchanged unless the user explicitly asks to migrate them.
- If a GitHub fetch, pull, or push fails, report the exact remote URL and auth error before changing remotes or credentials.
