#!/bin/sh
# Updates the bot on the server to the latest version of a branch and restarts it.
#   sh scripts/update.sh          - the branch that is checked out now
#   sh scripts/update.sh main     - the release version
#   sh scripts/update.sh beta     - the beta version
# The process name can be changed with PM2_NAME (default: dark-bot).
set -e
cd "$(dirname "$0")/.."
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
NAME="${PM2_NAME:-dark-bot}"

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
npm ci --omit=dev
pm2 restart "$NAME" --update-env
echo "Готово: ветка $BRANCH, $(git log -1 --format='%h %s')"
