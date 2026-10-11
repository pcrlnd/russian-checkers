<div align="center">

# ♛ Russian Checkers

**Real-time, browser-based Russian checkers (шашки).**
Create a game, share a link, play a friend — while others watch.

![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![WebSocket](https://img.shields.io/badge/realtime-WebSocket-blue)
![Dependencies](https://img.shields.io/badge/runtime%20deps-1-brightgreen)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

[Quick start](#-quick-start) · [Features](#-features) · [Behaviour](#-behaviour-in-detail) · [Rules](#-rules-implemented) · [Architecture](#-architecture)

</div>

---

## ✨ Features

| | |
| --- | --- |
| 🔗 **Invite links** | Create a game and send `/g/<id>` to friends. No accounts, no sign-up. |
| 👤 **Usernames** | Everyone is asked for a name before entering a game. |
| 🎯 **Host picks the opponent** | Joiners queue up for the host, who chooses who to play. Everyone else spectates. |
| 👀 **Spectators** | Unlimited viewers follow the game live, including pointers and selections. |
| 🖱️ **Live cursors** | Players see each other's pointer with a name label. Spectators see both. |
| ⚔️ **Capture guidance** | Mandatory captures are enforced and highlighted for every viewer. |
| 🔄 **Board orientation** | Flip the board per player, or use one shared view with your side top or bottom. |
| 🌗 **Light / dark theme** | Follows your system setting, with a manual toggle. |
| 🔊 **Sound & celebrations** | Synthesised move, capture and result sounds (with a mute button), plus confetti for the winner. |
| 📱 **Responsive** | Works on desktop, tablet and phone; tap or click to move. |
| 🤝 **Game flow** | Draw offers, resign, rematch with swapped colours, move list, auto-reconnect. |

## 🚀 Quick start

Pick whichever you prefer: run it directly with Node, or in Docker.

### Option 1 — Node.js

Requires **Node.js 18+**.

```bash
git clone https://github.com/pcrlnd/russian-checkers.git russian-checkers
cd russian-checkers
npm install
npm start
```

Open <http://localhost:3000>. Choose another port with `PORT=8080 npm start`.

### Option 2 — Docker

Requires Docker (Compose v2 for the second variant).

```bash
# plain Docker
docker build -t russian-checkers .
docker run -d --name russian-checkers -p 3000:3000 --restart unless-stopped russian-checkers

# or with Docker Compose
docker compose up -d --build
```

Open <http://localhost:3000>. To use another host port, map it differently (`-p 8080:3000`) or run `PORT=8080 docker compose up -d`.

Stop and remove it with `docker rm -f russian-checkers` or `docker compose down`. The image is based on `node:22-alpine`, runs as the unprivileged `node` user and includes a health check.

### Playing with people outside your network

Run it somewhere reachable (a VPS, a PaaS, or a tunnel such as `cloudflared` or `ngrok`). Behind an HTTPS reverse proxy the client automatically upgrades to `wss://`; make sure the proxy forwards WebSocket upgrades on `/ws`.

## 🎮 Behaviour in detail

### Creating and joining

- **Create:** enter a name, choose *White*, *Black* or *Random*, and press **Create game**. You go straight into the game and the invite link is in the side panel.
- **Join:** anyone opening the link is asked for a name first (pre-filled from their last visit).
- **Opponent selection**
  - While the second seat is open, joiners appear in the host's **Players asking to join** list.
  - The host presses **Play** next to one of them; all others become spectators.
  - Once an opponent is seated, every later joiner is a spectator.
  - A spectator can press **Ask to play** when the seat is open again.
- **Reconnecting:** a player who reloads or loses connection returns to the same seat (identity is a per-browser id). The host can free the seat of an offline opponent.

### Making a move

1. Click or tap one of your pieces. It is ringed in blue and its legal landing squares are dotted.
2. Click a dotted square. For a multi-jump, click each landing square in turn; visited squares are tinted and captured pieces fade.
3. `Esc` or clicking the piece again cancels the selection.

### Mandatory captures

- If you can capture, you must: only capturing moves are offered.
- Every piece that can capture **pulses green**, and this is visible to your opponent and to spectators too.
- Once a piece is selected, its landing squares are shown, with capture squares pulsing. A banner reminds you that the capture is mandatory.
- Any capture sequence may be chosen; there is no "maximum capture" requirement.

### What other people see

| | Opponent | Spectators |
| --- | :---: | :---: |
| Your mouse pointer with name label | ✅ | ✅ |
| Pulsing pieces that must capture | ✅ | ✅ |
| Your selected piece and landing squares | ✅ | ✅ |
| Move list and last move highlight | ✅ | ✅ |
| Both players' pointers | – | ✅ |

Touch input does not send a pointer position.

### Board orientation

Chosen on the start screen:

- **Flip the board for the opponent** *(default)*: each player sees their own pieces at the bottom. Spectators see white at the bottom.
- **Shared board**: untick the option and pick whether *your* side sits at the **bottom** or **top**. Everyone, spectators included, sees the same orientation.

Pointer and selection positions are exchanged in board coordinates, so they line up whichever way each viewer's board is turned.

### Ending a game

- **Win:** capture all enemy pieces or leave the opponent with no legal move.
- **Draw:** either player offers; the other accepts or declines. There is no automatic repetition draw.
- **Resign:** available to either player at any time.
- **Rematch:** after a game ends, either player offers; on acceptance colours swap and a new game starts.

## 📜 Rules implemented

- 8×8 board, play on the dark squares, white moves first.
- 12 pieces each. Men move one square diagonally **forward**.
- Men **capture backward and forward**.
- **Kings fly:** they move any distance along a diagonal and capture from any distance, landing on any free square beyond the captured piece.
- A flying king that can continue capturing **must** land on a square from which it can continue.
- **Multi-jumps** must be completed.
- A man that reaches the far row *during a capture* becomes a king immediately and continues capturing as a king.
- Captured pieces are removed **after** the move is finished (the "Turkish strike" rule): they block the path and cannot be jumped twice.
- Move notation uses columns A–H and rows 1–8: `C3-D4` for a move, `C3:E5:G7` for a capture sequence.

## 🏗 Architecture

```
server.js            Node http + ws server, rooms, authoritative game state
public/
  index.html         Single-file frontend (vanilla JS + CSS, no build step)
  rules.js           Rules engine shared by server and browser
Dockerfile           Container image
docker-compose.yml   One-command Docker deployment
```

| Part | Details |
| --- | --- |
| **Server** | Node's built-in `http` for static files and `POST /api/create`; the [`ws`](https://github.com/websockets/ws) library for WebSockets at `/ws`. |
| **State** | Held in memory per room. The server validates every move against the shared rules engine and broadcasts the new state. |
| **Messages** | Small JSON messages: `hello`, `move`, `select`, `cursor`, `offer`, `respond`, `resign`, `accept`, `release`, `wantplay`. |
| **Rules engine** | Dependency-free UMD module, used by the server for validation and by the browser for highlighting. |
| **Frontend** | Vanilla JS and CSS, theming through CSS custom properties. |

Rooms expire after 12 hours of inactivity and are lost on restart. Scaling beyond one process would need a shared store (e.g. Redis) and sticky routing.

## ⚠️ Limitations

- No clocks, chat or accounts.
- Moves are click/tap only (no drag and drop).
- Identity is a random id kept in `localStorage`. It is used to reconnect and to recognise the host, and is not real authentication.
- Draws are by agreement only.

## 📄 License

[MIT](LICENSE)
