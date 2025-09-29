// App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import './App.css';

// Use env var on production; fallback to localhost in dev
const SERVER_URL = (import.meta?.env?.VITE_SERVER_URL) || 'http://localhost:4000';

function useSocket(url) {
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    const s = io(url, { transports: ['websocket'], reconnection: true });
    setSocket(s);
    return () => s.disconnect();
  }, [url]);
  return socket;
}

function BingoLetters({ count }) {
  const letters = 'BINGO'.split('');
  return (
    <div className="bingo-letters" aria-label={`BINGO progress ${count} of 5`}>
      {letters.map((l, i) => (
        <div key={l} className={`bingo-letter ${i < count ? 'active' : ''}`}>{l}</div>
      ))}
    </div>
  );
}

function computeCompletedLines(marked) {
  if (!marked || !Array.isArray(marked) || marked.length !== 5) return null;
  const inLine = Array.from({ length: 5 }, () => Array(5).fill(false));

  // Rows
  for (let r = 0; r < 5; r++) {
    let full = true;
    for (let c = 0; c < 5; c++) if (!marked[r]?.[c]) { full = false; break; }
    if (full) for (let c = 0; c < 5; c++) inLine[r][c] = true;
  }
  // Cols
  for (let c = 0; c < 5; c++) {
    let full = true;
    for (let r = 0; r < 5; r++) if (!marked[r]?.[c]) { full = false; break; }
    if (full) for (let r = 0; r < 5; r++) inLine[r][c] = true;
  }
  // Diagonal TL-BR
  let full = true;
  for (let i = 0; i < 5; i++) if (!marked[i]?.[i]) { full = false; break; }
  if (full) for (let i = 0; i < 5; i++) inLine[i][i] = true;
  // Diagonal TR-BL
  full = true;
  for (let i = 0; i < 5; i++) if (!marked[i]?.[4 - i]) { full = false; break; }
  if (full) for (let i = 0; i < 5; i++) inLine[i][4 - i] = true;

  return inLine;
}

function Board({ board, marked, canClick, onPick, inLine }) {
  return (
    <div className="board-grid" role="grid" aria-label="Bingo board">
      {board?.flatMap((row, i) => row.map((num, j) => {
        const isMarked = !!marked?.[i]?.[j];
        const partOfLine = !!inLine?.[i]?.[j];
        return (
          <button
            key={`${i}-${j}-${num}`}
            role="gridcell"
            aria-pressed={isMarked}
            onClick={() => canClick && onPick(num)}
            className={`board-cell ${isMarked ? 'marked' : ''} ${partOfLine ? 'in-line' : ''} ${canClick ? 'clickable' : ''}`}
          >
            {num}
          </button>
        );
      }))}
    </div>
  );
}

export default function App() {
  const socket = useSocket(SERVER_URL);
  const [roomId, setRoomId] = useState('');
  const [playerRole, setPlayerRole] = useState(null); // 'P1' | 'P2' | 'SPECTATOR'
  const [state, setState] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'light';
    } catch {
      return 'light';
    }
  });
  const roomInputRef = useRef(null);

  // Reconnection + state sync
  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      // If we had a room, rejoin as spectator or player to sync state
      if (roomId) {
        socket.emit('joinRoom', { roomId }, (res) => {
          if (res?.error) return;
          setPlayerRole((prev) => res.player === 'SPECTATOR' ? prev ?? 'SPECTATOR' : res.player);
          setState(res.state);
        });
      }
    };
    const onState = (roomState) => setState({ ...roomState });
    socket.on('connect', onConnect);
    socket.on('stateUpdate', onState);
    return () => {
      socket.off('connect', onConnect);
      socket.off('stateUpdate', onState);
    };
  }, [socket, roomId]);

  // Apply theme to document
  useEffect(() => {
    try { localStorage.setItem('theme', theme); } catch {}
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  const createRoom = () => {
    if (!socket) return;
    socket.emit('createRoom', (res) => {
      setRoomId(res.roomId);
      setPlayerRole(res.player);
      setState(res.state);
    });
  };

  const joinRoom = () => {
    if (!socket) return;
    const id = roomInputRef.current?.value?.trim().toUpperCase();
    if (!id) return;
    socket.emit('joinRoom', { roomId: id }, (res) => {
      if (res?.error) return alert(res.error);
      setRoomId(res.roomId);
      setPlayerRole(res.player);
      setState(res.state);
    });
  };

  const pickNumber = (num) => {
    if (!socket || !state || !playerRole) return;
    if (state.finished) return;
    if (state.turn !== playerRole) return alert('Not your turn');
    socket.emit('selectNumber', { roomId, player: playerRole, number: num }, (res) => {
      if (res && res.error) alert(res.error);
    });
  };

  const restart = () => {
    if (!socket || !roomId) return;
    socket.emit('restartGame', { roomId });
  };

  const winnerText = useMemo(() => {
    if (!state?.finished) return null;
    if (state.lettersP1 >= 5 && state.lettersP2 >= 5) return 'Draw';
    if (state.lettersP1 >= 5) return 'Player 1';
    if (state.lettersP2 >= 5) return 'Player 2';
    return '—';
  }, [state]);

  const inLineP1 = useMemo(() => computeCompletedLines(state?.markedP1), [state?.markedP1]);
  const inLineP2 = useMemo(() => computeCompletedLines(state?.markedP2), [state?.markedP2]);

  const showP1 = state && (playerRole === 'P1' || playerRole === 'SPECTATOR');
  const showP2 = state && (playerRole === 'P2' || playerRole === 'SPECTATOR');

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <h1 className="title">Realtime Bingo</h1>
          <div className="actions">
            <button onClick={createRoom} className="btn primary">Create Room</button>
            <input ref={roomInputRef} placeholder="ROOM ID" className="input" aria-label="Room ID"/>
            <button onClick={joinRoom} className="btn success">Join Room</button>
            <button onClick={restart} className="btn danger">Restart</button>
            <button onClick={toggleTheme} className="btn">{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</button>
          </div>
        </header>

        <div className="meta">
          <div>Room: <strong>{roomId || '-'}</strong></div>
          <div>Role: <strong>{playerRole || '-'}</strong></div>
          <div>Turn: <strong>{state?.turn || '-'}</strong></div>
        </div>

        {!state && (
          <div className="panel">
            <p>Create or join a room to start. Share the room ID with the other player.</p>
          </div>
        )}

        {state && (
          <div className={`boards ${playerRole === 'SPECTATOR' ? 'two' : 'one'}`}>
            {showP1 && (
              <div className={`board-wrapper ${state.turn === 'P1' ? 'turn' : ''}`}>
                <div className="board-header">
                  <h2>Player 1</h2>
                  <BingoLetters count={state.lettersP1} />
                </div>
                <Board
                  board={state.boardP1}
                  marked={state.markedP1}
                  canClick={playerRole === 'P1'}
                  onPick={pickNumber}
                  inLine={inLineP1}
                />
              </div>
            )}
            {showP2 && (
              <div className={`board-wrapper ${state.turn === 'P2' ? 'turn' : ''}`}>
                <div className="board-header">
                  <h2>Player 2</h2>
                  <BingoLetters count={state.lettersP2} />
                </div>
                <Board
                  board={state.boardP2}
                  marked={state.markedP2}
                  canClick={playerRole === 'P2'}
                  onPick={pickNumber}
                  inLine={inLineP2}
                />
              </div>
            )}
          </div>
        )}

        {state?.finished && (
          <div className="modal">
            <div className="modal-card">
              <h3>Winner</h3>
              <p className="winner">{winnerText}</p>
              <button onClick={restart} className="btn primary">Restart</button>
            </div>
          </div>
        )}

        <footer className="footer">
          Note: Server holds room state in memory. For production, add persistence/auth.
        </footer>
      </div>
    </div>
  );
}


