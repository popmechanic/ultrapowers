#!/usr/bin/env bash
# fleet/reaper-key.sh — renew the key the hub removes finished VMs with, in one command.
#
#   bash fleet/reaper-key.sh
#
# The operator runs it; nothing is typed and the key is never printed. It mints a new exe.dev key
# that can only `rm` (label `hub-reaper-<date>-<time>`, one year), hands it to the hub-only
# `lobby-rm` integration on stdin, and then asks the hub's remover to remove a VM that does not
# exist: an answer other than `invalid token` means the remover holds a working key. On success it
# names the older `hub-reaper…` keys, which can then be deleted. Renewing by hand took five
# attempts on 2026-11-13 (a reused label, a paste into a waiting prompt, an empty stdin).
set -u
HUB="${KATA_HUB_HOST:-kata-hub.exe.xyz}"
label="hub-reaper-$(date -u +%Y-%m-%d-%H%M)"
hide() { sed -E 's/exe[0-9]+\.[A-Za-z0-9_-]+/<key hidden>/g'; }
probe() {
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$HUB" \
    "curl -sS -m 30 -X POST https://lobby-rm.int.exe.xyz/exec -d 'rm fleet-r0-doesnotexist-zz --json'" 2>&1
}

echo "1/3 making a new key, $label (it can only remove VMs, and lasts one year)"
out="$(ssh exe.dev "ssh-key generate-api-key --label=$label --cmds=rm --exp=1y" 2>&1)"
key="$(printf '%s\n' "$out" | grep -oE 'exe[0-9]+\.[A-Za-z0-9_-]{10,}' | head -n 1)"
if [ -z "$key" ]; then
  echo "STOPPED: exe.dev's answer held no key. It said:"; printf '%s\n' "$out" | hide; exit 1
fi

echo "2/3 handing it to the hub's remover"
for ending in newline none; do   # a key and a newline is the form that worked by hand on 2026-11-13
  if [ "$ending" = none ]; then said="$(printf '%s' "$key" | ssh exe.dev "integrations edit lobby-rm --bearer=-" 2>&1)"
  else said="$(printf '%s\n' "$key" | ssh exe.dev "integrations edit lobby-rm --bearer=-" 2>&1)"; fi
  printf '%s\n' "$said" | hide | sed 's/^/    exe.dev: /'
  echo "3/3 testing the remover from the hub"
  for try in 1 2 3; do
    sleep 3
    answer="$(probe)"
    case "$answer" in
      *"invalid token"*) ;;
      *) echo "WORKING: the hub's remover accepted the new key. It answered: $(printf '%s' "$answer" | hide | head -c 160)"
         old="$(ssh exe.dev "ssh-key list --json" 2>/dev/null | grep -oE '"name": *"hub-reaper[^"]*"' | sed -E 's/.*"(hub-reaper[^"]*)"/\1/' | grep -vx "$label")"
         if [ -n "$old" ]; then echo "Older keys you can now delete:"; for k in $old; do echo "    ssh exe.dev \"ssh-key remove $k\""; done; fi
         exit 0 ;;
    esac
  done
  echo "    the remover still answers invalid token; trying once more another way"
done
echo "NOT WORKING: the remover still answers invalid token with the new key $label."
echo "Nothing is worse than before. Tell Claude what this printed."
exit 1
