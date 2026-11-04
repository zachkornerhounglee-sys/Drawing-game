CANVAS COMBAT & CARTOGRAPHY - VERSION 9

FILES (upload ALL of them into the same folder, next to index.html)
  index.html     page layout
  style.css      styling
  network.js     PeerJS multiplayer
  classifier.js  weapons, trained recognizer, drawing pad
  sprites.js     embedded pixel-art sprites
  menu.js        title menu, settings, update log
  engine.js      game loop, physics, combat, rendering, online sync
  manifest.json  web-app manifest

GitHub Pages setup
1. Upload every file above to the ROOT of your repository, replacing the old ones.
2. Settings > Pages: deploy from main branch, / (root).
3. When it publishes press Ctrl+F5 once to clear the cached old version.
4. Open the site, Play > Multiplayer, copy the invite link and send it to friends.
   Friends open the invite link directly (it skips the title menu).
If any file is missing the status box (top right) says "GAME FILES NOT LOADED".
Double-clicking index.html plays solo offline.

WHAT'S NEW IN V9 (full list in the in-game UPDATE LOG on the title menu)
- 6 new weapons (14 total): Spear, Boomerang, Bomb, Storm Rod, Whip, Cyclone.
- New trained weapon recognizer, live top-3 guess while drawing, Undo (Ctrl+Z).
- Fall-through fixed; knockback fixed; mouse aim back (Settings can switch); double jump; drop-through (S).
- Multiplayer: host runs in a background tab, interpolation + prediction, compact snapshots, ping, silent-guest timeout.
- Performance: cached layers and glows, change-only DOM updates, adaptive quality.

TESTED: 23/23 end-to-end checks in real Chromium (two players over WebRTC) on this exact file set;
recognizer 97-99% on 4,200 generated sketches (~83% on unfamiliar styles); 0 fall-throughs in 3,300 trials;
21 -> 43 fps with 11 fighters on the same test machine.
NOT TESTED: two different real networks, mobile, Firefox, Safari.
LIMITS: strict firewalls that block WebRTC need your own relay; unusual weapon designs can be misread
(axe vs hammer most often) - check the live guess and redraw before equipping.
