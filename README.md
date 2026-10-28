# Canvas Combat & Cartography — GitHub Pages

## Publish on GitHub Pages
1. Extract this ZIP.
2. Upload **the contents** of this folder to the root of your GitHub repository (so `index.html` is at the repository root).
3. Keep the `js` and `css` folders and their files in place.
4. In GitHub, open **Settings → Pages**, select **Deploy from a branch**, choose your main branch and `/(root)`, then Save.
5. Open the published Pages URL and do a hard refresh (Ctrl+F5).

The HTML expects these paths:
- `css/style.css`
- `js/network.js`
- `js/classifier.js`
- `js/sprites.js`
- `js/menu.js`
- `js/engine.js`

The pixel-art sprite atlases are embedded in `js/sprites.js`, so there are no separate model/image files to upload. The game is a 2D canvas game and uses sprite art rather than 3D models. Multiplayer signaling uses PeerJS from a third-party CDN; if that service or the CDN is blocked by a school network, solo play should still start after the network fallback timeout.
