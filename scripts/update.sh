#!/usr/bin/env bash
# Switching and updating the bot on the server: release (main) or beta, with a check and an automatic rollback.
#
#   bash scripts/update.sh            обновить ту ветку, на которой сервер стоит сейчас
#   bash scripts/update.sh main       поставить релиз (последнюю версию ветки main)
#   bash scripts/update.sh beta       поставить бету (последнюю версию ветки beta)
#   bash scripts/update.sh rollback   вернуть последнюю версию, которая точно работала
#   bash scripts/update.sh status     что сейчас стоит и работает ли бот
#
# Before a switch the database is copied to data/backups. After the restart the script waits until the bot has logged in to
# Discord (data/status.json from this very process). If it does not come up in 90 seconds, the previous version is put back.
# Local edits of tracked files on the server are discarded (the server only runs what is on GitHub); .env and data/ stay.
# The pm2 process name can be changed with PM2_NAME (default: dark-bot).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${PM2_NAME:-dark-bot}"
STATUS="data/status.json"
LAST_GOOD="data/.last-good"
WAIT_SECONDS="${UPDATE_WAIT:-90}"

say() { printf '\n== %s\n' "$*"; }
current_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?"; }
current_commit() { git rev-parse HEAD 2>/dev/null || echo ""; }

show_status() {
  echo "Ветка: $(current_branch)   коммит: $(git log -1 --format='%h %s' 2>/dev/null || echo '?')"
  if [ -f "$STATUS" ]; then
    node -e "const s=require('./$STATUS');console.log('Бот: v'+s.bot+' · панель v'+s.panel+' · '+(s.channel==='beta'?'бета':'релиз')+' · '+s.tag+' · серверов: '+s.guilds+' · запущен '+new Date(s.readyAt).toLocaleString('ru-RU'))"
  fi
  [ -f "$LAST_GOOD" ] && echo "Последняя рабочая версия: $(cat "$LAST_GOOD")"
  pm2 describe "$NAME" >/dev/null 2>&1 && pm2 list | grep -E "name|$NAME" || echo "Процесс $NAME в pm2 не найден."
}

install_deps() {
  say "Зависимости (npm ci)"
  npm ci --omit=dev --no-audit --no-fund
  # sqlite3 is a compiled module: without it the bot cannot even open the database
  if ! node -e "require('sqlite3')" 2>/dev/null; then
    echo "sqlite3 не собрался — пересобираю"
    npm rebuild sqlite3 --foreground-scripts
    node -e "require('sqlite3')"
  fi
}

restart_bot() {
  say "Перезапуск $NAME"
  if pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" --update-env || { pm2 delete "$NAME"; start_bot; }
  else
    start_bot
  fi
  pm2 save >/dev/null 2>&1 || true
}
start_bot() {
  if [ "$NAME" = "dark-bot" ]; then pm2 start ecosystem.config.js --only dark-bot --update-env
  else pm2 start bot/index.js --name "$NAME" --update-env; fi
}

# Waits until a process started after $1 (ms) has logged in; 0 = up, 1 = not up in time.
wait_ready() {
  local since="$1" i
  for i in $(seq 1 "$WAIT_SECONDS"); do
    if [ -f "$STATUS" ] && node -e "const s=require('./$STATUS');process.exit(s.readyAt>=$since?0:1)" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

# Puts the code at <branch> <commit> on disk, installs and restarts; returns the result of wait_ready.
deploy() {
  local branch="$1" commit="$2" since
  git checkout -f -B "$branch" "$commit"
  install_deps
  since=$(node -e "console.log(Date.now())")
  restart_bot
  say "Жду, пока бот войдёт в Discord (до $WAIT_SECONDS с)"
  wait_ready "$since"
}

ARG="${1:-}"
case "$ARG" in
  status) show_status; exit 0 ;;
  rollback)
    [ -f "$LAST_GOOD" ] || { echo "Нет записи о рабочей версии (data/.last-good)."; exit 1; }
    read -r BRANCH TARGET < "$LAST_GOOD"
    say "Возвращаю $BRANCH @ ${TARGET:0:7}"
    ;;
  ""|main|beta)
    BRANCH="${ARG:-$(current_branch)}"
    [ "$BRANCH" = "HEAD" ] && { echo "Сервер не на ветке. Укажите: main или beta."; exit 1; }
    say "Скачиваю ветку $BRANCH с GitHub"
    git fetch --prune origin
    git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null || { echo "На GitHub нет ветки $BRANCH."; exit 1; }
    TARGET="$(git rev-parse "origin/$BRANCH")"
    ;;
  *) echo "Неизвестная команда: $ARG (можно: main, beta, rollback, status)"; exit 1 ;;
esac

PREV_BRANCH="$(current_branch)"
PREV_COMMIT="$(current_commit)"
say "Копия базы"
node scripts/backup-db.js "before-${BRANCH}" || echo "Копию сделать не удалось — продолжаю"

if deploy "$BRANCH" "$TARGET"; then
  echo "$BRANCH $(current_commit)" > "$LAST_GOOD"
  say "Готово"
  show_status
  exit 0
fi

say "Новая версия не запустилась за $WAIT_SECONDS с. Последние строки лога:"
pm2 logs "$NAME" --lines 30 --nostream || true
if [ -n "$PREV_COMMIT" ] && [ "$PREV_COMMIT" != "$(current_commit)" ]; then
  say "Возвращаю прежнюю версию: $PREV_BRANCH @ ${PREV_COMMIT:0:7}"
  if deploy "$PREV_BRANCH" "$PREV_COMMIT"; then
    echo "Бот снова работает на прежней версии. Пришлите лог выше — разберёмся с новой."
  else
    echo "Прежняя версия тоже не запустилась: смотрите pm2 logs $NAME"
  fi
fi
exit 1
