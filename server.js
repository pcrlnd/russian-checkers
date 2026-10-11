const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const R = require('./public/rules.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** @type {Map<string, Room>} */
const rooms = new Map();

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Guest';
const newId = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 7);

class Room {
  constructor(hostId, colorPref, mirror = true, hostBottom = true) {
    this.id = newId();
    this.hostId = hostId;
    this.colorPref = colorPref; // 'w' | 'b' | 'random'
    this.mirror = mirror; // true: each player sees their own colour at the bottom
    this.hostBottom = hostBottom; // when not mirrored: host's side is at the bottom
    this.people = new Map(); // clientId -> { id, name, sockets:Set }
    this.seats = { w: null, b: null }; // clientId
    this.lobby = []; // clientIds waiting for the host's pick (insertion order)
    this.touched = Date.now();
    this.resetGame();
  }

  resetGame() {
    this.board = R.initialBoard();
    this.turn = 'w';
    this.status = this.seats.w && this.seats.b ? 'playing' : 'waiting';
    this.result = null; // { winner: 'w'|'b'|null, reason }
    this.moves = []; // { color, text }
    this.lastMove = null;
    this.offer = null; // { kind: 'draw'|'rematch', from: 'w'|'b' }
  }

  bottomColor() {
    const hostColor = this.colorOfClient(this.hostId) || 'w';
    return this.hostBottom ? hostColor : R.other(hostColor);
  }

  colorOfClient(id) {
    return this.seats.w === id ? 'w' : this.seats.b === id ? 'b' : null;
  }

  online(id) {
    const p = this.people.get(id);
    return !!p && p.sockets.size > 0;
  }

  seatInfo(color) {
    const id = this.seats[color];
    if (!id) return null;
    return { name: this.people.get(id).name, online: this.online(id), host: id === this.hostId };
  }

  stateFor(id) {
    const myColor = this.colorOfClient(id);
    const isHost = id === this.hostId;
    const spectators = [...this.people.values()]
      .filter((p) => p.sockets.size && !this.colorOfClient(p.id) && !this.lobby.includes(p.id))
      .map((p) => p.name);
    return {
      t: 'state',
      room: this.id,
      you: { color: myColor, host: isHost, waiting: this.lobby.includes(id) },
      view: { mirror: this.mirror, bottom: this.mirror ? null : this.bottomColor() },
      status: this.status,
      board: this.board,
      turn: this.turn,
      result: this.result,
      moves: this.moves,
      lastMove: this.lastMove,
      offer: this.offer,
      players: { w: this.seatInfo('w'), b: this.seatInfo('b') },
      // only the host needs to know who is waiting for a pick
      lobby: isHost ? this.lobby.filter((x) => this.online(x)).map((x) => ({ id: x, name: this.people.get(x).name })) : undefined,
      lobbyCount: this.lobby.filter((x) => this.online(x)).length,
      spectators,
    };
  }

  broadcast() {
    for (const p of this.people.values()) {
      const msg = JSON.stringify(this.stateFor(p.id));
      for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
    }
  }

  sendTo(id, obj) {
    const p = this.people.get(id);
    if (!p) return;
    const msg = JSON.stringify(obj);
    for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
  }

  seat(id, color) {
    this.seats[color] = id;
    this.lobby = this.lobby.filter((x) => x !== id);
  }

  startGame() {
    this.resetGame();
    this.status = 'playing';
  }

  finish(winner, reason) {
    this.status = 'over';
    this.result = { winner, reason };
    this.offer = null;
  }
}

function handle(room, id, ws, msg) {
  const me = room.colorOfClient(id);
  const isHost = id === room.hostId;
  room.touched = Date.now();

  switch (msg.t) {
    case 'accept': {
      // host picks an opponent from the lobby
      if (!isHost || room.status !== 'waiting' || !room.lobby.includes(msg.id)) return;
      const hostColor = room.colorOfClient(id);
      const oppColor = R.other(hostColor);
      room.seat(msg.id, oppColor);
      room.lobby = []; // everyone else becomes a spectator
      room.startGame();
      return room.broadcast();
    }
    case 'wantplay': {
      // a spectator asks the host for the open seat
      if (me || isHost || room.lobby.includes(id) || (room.seats.w && room.seats.b)) return;
      room.lobby.push(id);
      return room.broadcast();
    }
    case 'release': {
      // host frees the opponent seat (opponent gone or declined to continue)
      if (!isHost) return;
      const oppColor = R.other(room.colorOfClient(id));
      const opp = room.seats[oppColor];
      if (!opp) return;
      if (room.online(opp) && room.status === 'playing') return;
      room.seats[oppColor] = null;
      room.resetGame();
      return room.broadcast();
    }
    case 'move': {
      if (room.status !== 'playing' || me !== room.turn || !Array.isArray(msg.path)) return;
      const legal = R.legalMoves(room.board, me);
      const mv = legal.find((m) => m.path.length === msg.path.length && m.path.every((s, i) => s === msg.path[i]));
      if (!mv) return ws.send(JSON.stringify({ t: 'error', msg: 'Illegal move' }));
      room.board = R.applyMove(room.board, mv);
      room.moves.push({ color: me, text: R.notation(mv), capture: mv.captures.length });
      room.lastMove = { path: mv.path, captures: mv.captures };
      room.turn = R.other(me);
      room.offer = null;
      if (!R.legalMoves(room.board, room.turn).length) room.finish(me, 'no-moves');
      return room.broadcast();
    }
    case 'resign': {
      if (room.status !== 'playing' || !me) return;
      room.finish(R.other(me), 'resign');
      return room.broadcast();
    }
    case 'offer': {
      if (!me || !['draw', 'rematch'].includes(msg.kind)) return;
      if (msg.kind === 'draw' && room.status !== 'playing') return;
      if (msg.kind === 'rematch' && room.status !== 'over') return;
      if (!room.seats.w || !room.seats.b) return;
      if (room.offer && room.offer.from !== me && room.offer.kind === msg.kind) {
        // both sides asked: treat as acceptance
        return resolveOffer(room, true);
      }
      room.offer = { kind: msg.kind, from: me };
      return room.broadcast();
    }
    case 'respond': {
      if (!me || !room.offer || room.offer.from === me) return;
      return resolveOffer(room, !!msg.accept);
    }
    case 'select': {
      // the mover's current selection, shown to the opponent and spectators
      if (!me) return;
      const p = msg.path;
      const ok = Array.isArray(p) && p.length <= 16 && p.every((n) => Number.isInteger(n) && n >= 0 && n < 64);
      for (const pid of room.people.keys()) {
        if (pid !== id) room.sendTo(pid, { t: 'select', color: me, path: ok ? p : null });
      }
      return;
    }
    case 'cursor': {
      // relayed to the opponent and to spectators, tagged with the sender's colour
      if (!me) return;
      const x = msg.x, y = msg.y;
      const ok = typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y);
      for (const pid of room.people.keys()) {
        if (pid !== id) room.sendTo(pid, { t: 'cursor', color: me, x: ok ? x : null, y: ok ? y : null });
      }
      return;
    }
  }
}

function resolveOffer(room, accepted) {
  const { kind } = room.offer;
  room.offer = null;
  if (accepted && kind === 'draw' && room.status === 'playing') room.finish(null, 'draw');
  else if (accepted && kind === 'rematch' && room.status === 'over') {
    [room.seats.w, room.seats.b] = [room.seats.b, room.seats.w]; // swap colours
    room.startGame();
  }
  room.broadcast();
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/create') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const { clientId, color, mirror, hostBottom } = JSON.parse(body || '{}');
        if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 64) throw 0;
        const room = new Room(clientId, ['w', 'b', 'random'].includes(color) ? color : 'random', mirror !== false, hostBottom !== false);
        rooms.set(room.id, room);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ room: room.id }));
      } catch {
        res.writeHead(400).end('bad request');
      }
    });
    return;
  }
  if (req.method !== 'GET') return res.writeHead(405).end();

  let file;
  if (url.pathname === '/' || /^\/g\/[\w-]+$/.test(url.pathname)) file = 'index.html';
  else file = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return res.writeHead(403).end();
  fs.readFile(full, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  let room = null, id = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!room) {
      if (msg.t !== 'hello') return;
      const r = rooms.get(String(msg.room));
      if (!r) return ws.send(JSON.stringify({ t: 'missing' }));
      if (typeof msg.clientId !== 'string' || msg.clientId.length < 8 || msg.clientId.length > 64) return;
      room = r; id = msg.clientId;
      const name = cleanName(msg.name);
      let person = room.people.get(id);
      if (!person) {
        person = { id, name, sockets: new Set() };
        room.people.set(id, person);
      }
      person.name = name;
      person.sockets.add(ws);
      const isHost = id === room.hostId;
      if (isHost && !room.seats.w && !room.seats.b) {
        const c = room.colorPref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : room.colorPref;
        room.seats[c] = id;
      }
      // a newcomer waits for the host's pick only while the second seat is open
      const seated = room.colorOfClient(id);
      const open = !room.seats.w || !room.seats.b;
      if (!seated && !isHost && open && !room.lobby.includes(id)) room.lobby.push(id);
      room.touched = Date.now();
      return room.broadcast();
    }
    handle(room, id, ws, msg);
  });

  ws.on('close', () => {
    if (!room) return;
    const p = room.people.get(id);
    if (p) p.sockets.delete(ws);
    if (p && !p.sockets.size) {
      const c = room.colorOfClient(id);
      if (c) for (const pid of room.people.keys()) room.sendTo(pid, { t: 'cursor', color: c, x: null, y: null });
    }
    room.broadcast();
  });
  ws.on('error', () => {});
});

// heartbeat so dead connections drop out of presence
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);
wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

// drop rooms idle for 12h
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > 12 * 3600 * 1000) rooms.delete(k);
}, 600000);

server.listen(PORT, () => console.log(`Russian checkers on http://localhost:${PORT}`));
