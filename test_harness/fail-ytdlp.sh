#!/bin/bash
# Stand-in for a yt-dlp that fails the way YouTube does for age-restricted videos.
echo "ERROR: [youtube] 3UxEwmfZq04: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication." >&2
exit 1
