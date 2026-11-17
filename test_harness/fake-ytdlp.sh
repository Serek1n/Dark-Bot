#!/bin/bash
# Stand-in for yt-dlp in the music tests: writes its arguments to a log and "streams" nothing for a while.
# A search (ytsearchN:...) answers at once with three results of different lengths: 1:00, 3:05 and 1:00:00.
echo "$@" >> "${FAKE_YTDLP_LOG:-/tmp/fake-ytdlp-audio.log}"
for a in "$@"; do
  case "$a" in
    ytsearch*:*)
      echo '{"entries":[{"id":"short","title":"Song (teaser)","duration":60,"url":"https://www.youtube.com/watch?v=short"},{"id":"right","title":"Artist - Song","duration":185,"url":"https://www.youtube.com/watch?v=right"},{"id":"hour","title":"Song 1 hour","duration":3600,"url":"https://www.youtube.com/watch?v=hour"}]}'
      exit 0;;
  esac
done
sleep 5
