# Ship it

Ship it runs the pull-request loop you usually babysit: open the PR, get it reviewed, fix comments and CI, merge, and check the merge.

## Start it

Open a session, click **Ship it**, and choose:

- **Slack channel** for review requests (optional; you can set one per PR later).
- **Steps**: for each one, **Auto** (it just happens) or **Ask me** (you get a card with a Send button).
- **Fix rounds**: how many times it may fix review comments or CI per PR before asking you (3 by default).

Click **Start**.

## The steps

| Step | What happens | Default |
|---|---|---|
| Open the PR | When the session has uncommitted work, ask it to commit, push and open a PR. | Auto |
| Fix review comments | New review feedback or unresolved threads go to the session, which fixes, pushes and replies. | Auto |
| Fix failing CI | The session finds the failing check, fixes it and pushes. | Auto |
| Merge when approved | Approved, green and nothing open: ask the session to merge. | Ask me |
| Post-merge checks (optional) | After merge: check CI on main, the deploy rollout and logs, plus your own instructions. Checks only; production changes still ask you. | Off |

Approving is always left to your reviewers.

## One session, many PRs

Every PR you open in the session gets its own panel. New PRs show up within about 15 seconds, even if the link never appeared on screen. You get a notification for each new one.

## Review setup per PR

Each PR has its own review setup. A new PR shows **Not sent for review yet. Choose…**. Click **Choose**:

- **Slack channel**: posts "Ready for review" with the link.
- **DM on Slack**: type a name and pick people from your workspace. Each gets the link once. Leave the channel empty to send only DMs.
- **GitHub reviewers**: requested on the PR.

Nothing is posted until you choose. **Drafts wait**: a draft isn't posted or DMed until it's marked ready for review.

## When is a PR ready to merge?

All of these:

- Approved.
- CI green.
- No unresolved review threads.
- Nobody's latest review is "changes requested".
- Reviewers you chose in Polyergon have reviewed. Reviewers GitHub added on its own (CODEOWNERS, team auto-assign) don't hold it back.
- Copilot reviewed the latest commit. Polyergon asks Copilot to re-review after new pushes.

The step bar shows the first thing still missing, like "CI running" or "2 open threads".

## Is it working right now?

Each PR has a status line:

- 🔵 **Claude is working on this PR now.**
- 🔵 **Queued**: Claude takes it when the session is free.
- 🟠 **Waiting for you**: send or dismiss the suggestion.
- 🟢 **Automation active, watching**, and what it's waiting for.
- ⚪ **Automation stopped.**

## Tell Claude about a PR

Each PR panel has a box: **Tell Claude about this PR**. For example:

> let the product team (Maya and Noam) know it's ready, in one group DM

The session does it when it's free, with the PR as context.

## Post-merge checks

In **Steps**, set **Post-merge checks** to Auto or Ask me. In the **Also** box, add your own instructions and click **Save**, for example:

> use the post-merge-verify skill; check the billing-service pods in prod-us and prod-eu

After the merge, the PR shows **Post-merge checks**, then **Post-merge checks done**.

## Finishing

- Click a PR's **done · Close** badge to fold it into a green **finished** line. Click the line to bring it back.
- When every PR is done, the automation shows **✓ done · Close** on the Automations page.
