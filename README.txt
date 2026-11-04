CANVAS COMBAT & CARTOGRAPHY - VERSION 9

GitHub Pages setup
1. Upload index.html to the ROOT of your GitHub repository, replacing the previous index.html.
2. Commit and wait for GitHub Pages to publish. (This is a single self-contained file: sprites,
   weapon-recognition model and all code are embedded.)
3. Open the published link, choose Play > Multiplayer, copy the invite link and send it to friends.
   Friends open the invite link directly; it skips the title menu.

What's new (also in the in-game UPDATE LOG on the title menu)
- 6 new weapons (14 total): Spear, Boomerang, Bomb, Storm Rod (chain lightning), Whip, Cyclone.
- New weapon recognizer (trained model, 132 shape features) with a LIVE GUESS panel, Undo (Ctrl+Z)
  and a runner-up line in the equip notification.
- Fall-through fixed (two causes: players pushed down into platforms when they landed on each
  other, and void respawns into thin air that could leave you alive at 0 HP).
- Mouse aim is back (Settings can switch to facing-only), knockback works, invisible tiles removed.
- Double jump, ledge grace time, drop-through (hold S).
- Multiplayer: host keeps running in a background tab, interpolation + client prediction, compact
  snapshots, ping readout, silent-guest timeout, safer weapon-art transfer, more STUN + TURN relays.
- Performance: cached stage layers, cached glows, DOM updates only on change, adaptive quality.

Testing done on this build (headless + real Chromium)
- Recognizer: 97-99% on 4,200 generated mouse sketches across 14 weapons; ~83% on drawing styles it
  never trained on. 24/24 shapes drawn through the real pad were read correctly.
- Physics: 0 of 3,000 standing / 0 of 300 head-landing players fell through (v8 logic: 1000/1000
  head-landings fell in a replay). 60 s brawl with all 14 weapons: no zombies, no void escapes.
- Multiplayer: two Chromium pages over real WebRTC via a local signalling server: join, weapon sync,
  movement agreement, jump, ping, host with rendering frozen, guest leaving: 23/23 checks.
- Speed (same machine, 11 fighters): 21 fps -> 43 fps, main-thread load 102% -> 79%.

Known limits
- Online play uses public PeerJS signalling and public STUN/TURN servers. If a network blocks WebRTC
  entirely, a static GitHub Pages site cannot relay game traffic; you would need your own relay.
  A custom PeerJS server can be set with window.CCC_PEER_CONFIG = { host, port, path, secure }.
- Not tested: a real internet connection between two different networks, mobile browsers, or
  Firefox / Safari.
- Very unusual weapon designs can still be misread (axe vs hammer is the usual confusion); watch the
  live guess and redraw or Undo before equipping.
