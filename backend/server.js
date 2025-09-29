// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 4000;

function generateBoard() {
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const board = [];
  for (let r = 0; r < 5; r++) board.push(nums.slice(r * 5, r * 5 + 5));
  return board;
}

function emptyMarked() {
  return Array.from({ length: 5 }, () => Array(5).fill(false));
}

function checkLines(marked) {
  let lines = 0;
  // rows
  for (let i = 0; i < 5; i++) if (marked[i].every(Boolean)) lines++;
  // cols
  for (let j = 0; j < 5; j++) {
    let col = true;
    for (let i = 0; i < 5; i++) if (!marked[i][j]) { col = false; break; }
    if (col) lines++;
  }
  // diag 1
  if (Array.from({ length: 5 }, (_, i) => marked[i][i]).every(Boolean)) lines++;
  // diag 2
  if (Array.from({ length: 5 }, (_, i) => marked[i][4 - i]).every(Boolean)) lines++;
  return lines;
}

// roomId -> room state
/**
 * room = {
 *   players: { [socketId]: 'P1'|'P2'|'SPECTATOR' },
 *   sockets: { P1?: socketId, P2?: socketId, [key: string]: socketId },
 *   boardP1: number[5][5],
 *   boardP2: number[5][5],
 *   markedP1: boolean[5][5],
 *   markedP2: boolean[5][5],
 *   turn: 'P1'|'P2',
 *   lettersP1: number,
 *   lettersP2: number,
 *   finished: boolean
 * }
 */
const rooms = {};

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', (cb) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const boardP1 = generateBoard();
    const boardP2 = generateBoard();
    rooms[roomId] = {
      players: {}, // socketId -> player ('P1' or 'P2')
      sockets: {},
      boardP1,
      boardP2,
      markedP1: emptyMarked(),
      markedP2: emptyMarked(),
      turn: 'P1',
      lettersP1: 0,
      lettersP2: 0,
      finished: false
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = 'P1';
    rooms[roomId].sockets['P1'] = socket.id;
    cb({ roomId, player: 'P1', state: rooms[roomId] });
  });

  socket.on('joinRoom', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ error: 'Room not found' });
    // If already two players, allow spectator
    const takenRoles = [room.sockets['P1'], room.sockets['P2']].filter(Boolean).length;
    if (takenRoles >= 2) {
      room.players[socket.id] = 'SPECTATOR';
      room.sockets['SPEC_' + socket.id] = socket.id;
      socket.join(roomId);
      return cb({ roomId, player: 'SPECTATOR', state: room });
    }
    socket.join(roomId);
    const role = room.sockets['P1'] ? 'P2' : 'P1';
    room.players[socket.id] = role;
    room.sockets[role] = socket.id;
    cb({ roomId, player: role, state: room });
    io.to(roomId).emit('stateUpdate', room);
  });

  socket.on('selectNumber', ({ roomId, player, number }, cb) => {
    const room = rooms[roomId];
    if (!room || room.finished) return cb && cb({ error: 'Invalid room or game finished' });
    if (room.turn !== player) return cb && cb({ error: 'Not your turn' });

    // mark number on both boards
    function markOn(board, marked) {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (board[i][j] === number) marked[i][j] = true;
    }
    markOn(room.boardP1, room.markedP1);
    markOn(room.boardP2, room.markedP2);

    // update letters (lines count)
    room.lettersP1 = Math.min(5, checkLines(room.markedP1));
    room.lettersP2 = Math.min(5, checkLines(room.markedP2));

    // check finish
    if (room.lettersP1 >= 5 || room.lettersP2 >= 5) {
      room.finished = true;
    } else {
      room.turn = room.turn === 'P1' ? 'P2' : 'P1';
    }

    io.to(roomId).emit('stateUpdate', room);
    cb && cb({ ok: true });
  });

  socket.on('restartGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.boardP1 = generateBoard();
    room.boardP2 = generateBoard();
    room.markedP1 = emptyMarked();
    room.markedP2 = emptyMarked();
    room.turn = 'P1';
    room.lettersP1 = 0;
    room.lettersP2 = 0;
    room.finished = false;
    io.to(roomId).emit('stateUpdate', room);
  });

  socket.on('disconnect', () => {
    // remove from rooms map players mapping
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        const role = room.players[socket.id];
        delete room.players[socket.id];
        // remove sockets mapping
        for (const k of Object.keys(room.sockets)) {
          if (room.sockets[k] === socket.id) delete room.sockets[k];
        }
        io.to(roomId).emit('stateUpdate', room);
      }
      // Optionally clean empty rooms
      if (Object.keys(room.players).length === 0 && Object.keys(room.sockets).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

app.get('/', (_req, res) => {
  res.send('Bingo WebSocket server is running');
});

server.listen(PORT, () => console.log('Server listening on', PORT));


