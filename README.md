Watch Party — Static Proof of Concept

Overview
- Static site that embeds VidFast player and uses Ably for realtime sync + chat.
- Client-side password gate (NOT secure) and cookie-saved username.
- Works on GitHub Pages (static hosting).

Quick setup
1. Fill `ABLY_API_KEY` in `app.js` with your Ably client key (publishable key).
2. Optionally change `DEMO_PASSWORD` in `app.js`.
3. Choose media by providing URL params when opening the page:
   - Movie: `?type=movie&id=533535`
   - TV: `?type=tv&id=63174&season=1&episode=1`
   - Room: `&room=myroom` to isolate parties.

Deploy
- Commit these files to a GitHub repo and enable GitHub Pages on the `main` branch (or `gh-pages`).

Notes & limitations
- This is a client-side proof of concept. Password protection is client-side only and not secure.
- Keep your Ably key scoped appropriately; for production use Ably token auth via a server.
- VidFast iframe is embedded via their public endpoints; check their TOS for usage.

Files
- `index.html` — main page
- `styles.css` — layout & responsive
- `app.js` — logic: password, Ably, player sync, chat

If you want, I can:
- Add a GitHub Actions workflow to deploy to Pages automatically.
- Add token-auth instructions for Ably using a tiny server.
