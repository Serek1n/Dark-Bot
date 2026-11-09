#!/usr/bin/env bash
# Updating the bot on the server to the latest version from GitHub (branch main), with a check and an automatic rollback.
#
#   bash scripts/update.sh            поставить последнюю версию (ветка main)
#   bash scripts/update.sh rollback   вернуть последнюю версию, которая точно работала
#   bash scripts/update.sh status     что сейчас стоит и работает ли бот
#
# Before an update the database is copied to data/backups. After the restart the script waits until the bot has logged in to
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
    node -e "const s=require('./$STATUS');console.log('Бот: v'+s.bot+' · панель v'+s.panel+' · '+s.tag+' · серверов: '+s.guilds+' · запущен '+new Date(s.readyAt).toLocaleString('ru-RU'))"
  fi
  [ -f "$LAST_GOOD" ] && echo "Последняя рабочая версия: $(cat "$LAST_GOOD")"
  pm2 describe "$NAME" >/dev/null 2>&1 && pm2 list | grep -E "name|$NAME" || echo "Процесс $NAME в pm2 не найден."
}

# ffmpeg for music is downloaded from GitHub. It is kept in data/cache between updates, so a GitHub hiccup (504) cannot
# break an update, and it is not downloaded again every time.
FF_CACHE="data/cache/ffmpeg"
ffmpeg_path() { node -p "require('ffmpeg-static') || ''" 2>/dev/null || true; }
keep_ffmpeg() {
  local f; f="$(ffmpeg_path)"
  if [ -n "$f" ] && [ -s "$f" ]; then mkdir -p "$(dirname "$FF_CACHE")"; cp -f "$f" "$FF_CACHE"; fi
}

# Installs what the bot needs. Packages come from the npm registry; nothing that downloads from GitHub can stop it:
# sqlite3 is required (the database), the voice codec and ffmpeg are not (music falls back to other ways).
install_deps() {
  local i ok f
  keep_ffmpeg || true
  say "Зависимости (npm ci)"
  ok=0
  for i in 1 2 3; do
    if npm ci --omit=dev --no-audit --no-fund --ignore-scripts; then ok=1; break; fi
    echo "npm ci не прошёл (попытка $i из 3) — повторю через 15 с"; sleep 15
  done
  [ "$ok" = 1 ] || { echo "Не удалось скачать зависимости. Проверьте интернет на сервере и запустите обновление ещё раз."; return 1; }

  say "База данных (sqlite3)"
  ok=0
  for i in 1 2 3; do
    if npm rebuild sqlite3 --foreground-scripts && node -e "require('sqlite3')"; then ok=1; break; fi
    echo "sqlite3 не установился (попытка $i из 3) — повторю через 15 с"; sleep 15
  done
  [ "$ok" = 1 ] || { echo "sqlite3 не установился: бот не сможет открыть базу."; return 1; }

  say "Музыка (ffmpeg и голосовой кодек)"
  npm rebuild @discordjs/opus >/dev/null 2>&1 || echo "Кодек @discordjs/opus не собрался — музыка будет работать через opusscript."
  f="$(ffmpeg_path)"
  if [ -n "$f" ] && [ ! -s "$f" ] && [ -s "$FF_CACHE" ]; then cp -f "$FF_CACHE" "$f"; chmod +x "$f"; echo "ffmpeg взят из сохранённой копии."; fi
  if [ -n "$f" ] && [ ! -s "$f" ]; then
    ok=0
    for i in 1 2 3; do
      if (cd node_modules/ffmpeg-static && node install.js); then ok=1; break; fi
      echo "ffmpeg не скачался (попытка $i из 3)"; sleep 10
    done
    [ "$ok" = 1 ] || echo "ffmpeg скачать не удалось — бот работает, музыка возьмёт системный ffmpeg, если он установлен (apt install ffmpeg)."
  fi
  keep_ffmpeg || true
  return 0
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
  install_deps || return 1
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
    read -r _ TARGET < "$LAST_GOOD"
    BRANCH=main
    say "Возвращаю $BRANCH @ ${TARGET:0:7}"
    ;;
  ""|main)
    BRANCH=main
    say "Скачиваю последнюю версию с GitHub"
    git fetch --prune origin
    git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null || { echo "На GitHub нет ветки $BRANCH."; exit 1; }
    TARGET="$(git rev-parse "origin/$BRANCH")"
    ;;
  *) echo "Неизвестная команда: $ARG (можно: без слова — обновить, rollback, status)"; exit 1 ;;
esac

PREV_BRANCH="$(current_branch)"
PREV_COMMIT="$(current_commit)"
say "Копия базы"
node scripts/backup-db.js "before-${BRANCH}" || echo "Копию сделать не удалось — продолжаю"

if deploy "$BRANCH" "$TARGET"; then
  echo "$BRANCH $(current_commit)" > "$LAST_GOOD"
  # the beta branch is no longer used: drop the old local copy if the server still has one
  if [ "$BRANCH" = "main" ] && git rev-parse --verify --quiet refs/heads/beta >/dev/null; then git branch -D beta >/dev/null 2>&1 || true; fi
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
