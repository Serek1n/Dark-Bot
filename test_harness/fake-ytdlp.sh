#!/bin/bash
# Stand-in for yt-dlp in the music tests: writes its arguments to a log and "streams" nothing for a while.
echo "$@" >> "${FAKE_YTDLP_LOG:-/tmp/fake-ytdlp-audio.log}"
sleep 5
