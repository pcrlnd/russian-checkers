// Russian checkers rules. Shared by the server (authoritative) and the browser (UI hints).
// Board: array of 64, index = row*8 + col, row 0 at the top (black's side).
// Cells: '' empty, 'w'/'b' men, 'W'/'B' kings. Dark squares are those with (row+col) odd.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const colorOf = (p) => (p ? p.toLowerCase() : '');
  const isKing = (p) => p === 'W' || p === 'B';
  const promoRow = (color) => (color === 'w' ? 0 : 7);
  const other = (color) => (color === 'w' ? 'b' : 'w');

  function initialBoard() {
    const b = Array(64).fill('');
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if ((r + c) % 2 === 1) {
          if (r < 3) b[r * 8 + c] = 'b';
          else if (r > 4) b[r * 8 + c] = 'w';
        }
    return b;
  }

  // All maximal capture sequences for the piece on `from`.
  // Captured pieces stay on the board until the move ends (they block and cannot be jumped twice).
  function captureSeqs(board, from) {
    const piece = board[from];
    const color = colorOf(piece);
    const b = board.slice();
    b[from] = '';

    function dfs(pos, king, cap, path) {
      const r = pos >> 3, c = pos & 7;
      const out = [];
      for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc;
        if (king) while (inb(rr, cc) && b[rr * 8 + cc] === '') { rr += dr; cc += dc; }
        if (!inb(rr, cc)) continue;
        const over = rr * 8 + cc, p = b[over];
        if (!p || colorOf(p) === color || cap.includes(over)) continue;
        const lands = [];
        let lr = rr + dr, lc = cc + dc;
        while (inb(lr, lc) && b[lr * 8 + lc] === '') {
          lands.push(lr * 8 + lc);
          if (!king) break;
          lr += dr; lc += dc;
        }
        const cont = [], term = [];
        for (const l of lands) {
          const k2 = king || (l >> 3) === promoRow(color);
          const cap2 = cap.concat(over), path2 = path.concat(l);
          const sub = dfs(l, k2, cap2, path2);
          if (sub.length) cont.push(...sub);
          else term.push({ from, path: path2, captures: cap2, king: k2 });
        }
        // a flying king that can keep capturing must land where it can continue
        out.push(...(cont.length ? cont : term));
      }
      return out;
    }
    return dfs(from, isKing(piece), [], [from]);
  }

  function simpleMoves(board, from) {
    const piece = board[from], color = colorOf(piece), king = isKing(piece);
    const r = from >> 3, c = from & 7, out = [];
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== (color === 'w' ? -1 : 1)) continue;
      let rr = r + dr, cc = c + dc;
      while (inb(rr, cc) && board[rr * 8 + cc] === '') {
        const to = rr * 8 + cc;
        out.push({ from, path: [from, to], captures: [], king: king || rr === promoRow(color) });
        if (!king) break;
        rr += dr; cc += dc;
      }
    }
    return out;
  }

  // Legal moves for `color`; captures are mandatory (any capture sequence may be chosen).
  function legalMoves(board, color) {
    const caps = [], simple = [];
    for (let i = 0; i < 64; i++) {
      if (colorOf(board[i]) !== color) continue;
      caps.push(...captureSeqs(board, i));
    }
    if (caps.length) return caps;
    for (let i = 0; i < 64; i++) if (colorOf(board[i]) === color) simple.push(...simpleMoves(board, i));
    return simple;
  }

  function applyMove(board, move) {
    const b = board.slice();
    const piece = b[move.from];
    b[move.from] = '';
    for (const i of move.captures) b[i] = '';
    const to = move.path[move.path.length - 1];
    const color = colorOf(piece);
    b[to] = move.king ? color.toUpperCase() : piece;
    return b;
  }

  // The single square strictly between two squares on one diagonal that holds a piece (or -1).
  function between(board, a, z) {
    const dr = Math.sign((z >> 3) - (a >> 3)), dc = Math.sign((z & 7) - (a & 7));
    let r = (a >> 3) + dr, c = (a & 7) + dc;
    while (r * 8 + c !== z) {
      if (board[r * 8 + c]) return r * 8 + c;
      r += dr; c += dc;
    }
    return -1;
  }

  const sqName = (i) => 'ABCDEFGH'[i & 7] + (8 - (i >> 3));
  const notation = (move) => move.path.map(sqName).join(move.captures.length ? ':' : '-');

  return { initialBoard, legalMoves, captureSeqs, applyMove, between, colorOf, isKing, other, sqName, notation };
});
