# Canvas Combat & Cartography — GitHub-ready single-file build

## Publish it
1. Extract this ZIP.
2. Upload **index.html** to the root of your GitHub repository (replace the old index.html).
3. In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, select your main branch and **/(root)**, then Save.
4. Open your GitHub Pages link and press **Ctrl+F5** to force-refresh the page.

All CSS, game logic, sprites, and sprite art are embedded in `index.html`, so there are no `js/` or `css/` folders to accidentally miss. The weapon/effect art is sprite-based 2D canvas art, not 3D models. Multiplayer uses PeerJS from a CDN; if that is unavailable or blocked by a network, the game should switch to solo mode.
