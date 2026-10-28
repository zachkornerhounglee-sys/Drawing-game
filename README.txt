CANVAS COMBAT & CARTOGRAPHY — VERSION 8

GitHub Pages setup
1. Extract this ZIP.
2. Upload index.html to the ROOT of your existing GitHub repository, replacing the previous index.html.
3. Commit the changes and wait for GitHub Pages to publish.
4. Open the host's published game link, choose Play > Multiplayer, and copy the invite link.
5. Friends should open that invite link directly. It skips the title menu and retries joining the exact room instead of silently creating a different room.

Multiplayer notes
- Uses PeerJS WebRTC peer-to-peer signalling from two public CDNs, with a fallback if one CDN fails.
- Host snapshots and guest input are sent at 30 Hz to reduce bandwidth on slower networks.
- The game retries transient connection errors. If your network blocks both PeerJS CDNs or direct WebRTC traffic, static GitHub Pages alone cannot relay game traffic; a separate multiplayer relay/server would be needed for that network.
- This ZIP contains a single self-contained index.html; the sprites and game code are embedded.
