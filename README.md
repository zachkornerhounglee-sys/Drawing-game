# Canvas Combat & Cartography — Version 9

Draw the arena, draw your weapon, brawl. Peer-to-peer multiplayer over WebRTC (PeerJS), no server of your own.

## Files (all go in the SAME folder, next to each other)

| File | What it is |
|---|---|
| `index.html` | Page layout; loads the files below |
| `style.css` | All styling |
| `network.js` | PeerJS multiplayer layer |
| `classifier.js` | Weapon table + icons, trained weapon recognizer, drawing pad |
| `sprites.js` | Embedded pixel-art sprite atlases (bow, arrows, slashes, elements, boiling title text) |
| `menu.js` | Title menu, settings, **update log** |
| `engine.js` | Game loop, physics, combat, bots, rendering, online sync |
| `manifest.json` | Web-app manifest |

## Publish on GitHub Pages
1. Upload **every file above** to the root of your repository (replace the old ones).
2. **Settings → Pages**: deploy from your main branch, `/ (root)`.
3. After it publishes, press **Ctrl + F5** once to clear the cached old version.
4. Open the site, choose **Play → Multiplayer**, copy the invite link, send it to friends.

If a file is missing the status box (top right) says `GAME FILES NOT LOADED`.
You can also double-click `index.html` to play solo offline.

## What's new in v9
- 6 new weapons (14 total): Spear, Boomerang, Bomb, Storm Rod, Whip, Cyclone.
- New trained weapon recognizer with a live top-3 guess while you draw, Undo (Ctrl+Z) and a runner-up line.
- Fall-through fixed (players pushed into platforms when stacking; void respawns into thin air).
- Mouse aim restored (Settings can switch to facing-only), working knockback, double jump, drop-through (hold S).
- Multiplayer: host keeps running in a background tab, interpolation + prediction, compact snapshots, ping readout, silent-guest timeout, safer weapon-art transfer, extra STUN/TURN servers.
- Performance: cached stage layers and glows, DOM updates only on change, adaptive quality.

The full list is in the in-game **UPDATE LOG** (title menu).

## Tested
Headless and in real Chromium (two pages over real WebRTC through a local signalling server): 23/23 end-to-end checks on this exact file set;
recognizer 97–99% on 4,200 generated sketches (~83% on drawing styles it never trained on);
0 fall-throughs in 3,000 standing and 300 head-landing trials; 21 → 43 fps with 11 fighters in the same test machine.

## Not tested / limits
- Two different real networks over the internet, mobile browsers, Firefox, Safari.
- Strict firewalls that block WebRTC entirely need your own relay server; a custom PeerJS server can be set with `window.CCC_PEER_CONFIG = { host, port, path, secure }`.
- Unusual weapon designs can still be misread (axe vs hammer most often). Check the live guess and redraw before equipping.
