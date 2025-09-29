// App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';

// Adjust if your server runs elsewhere
const SERVER_URL = 'http://localhost:4000';

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
    <div className="flex space-x-2 text-xl font-bold" aria-label={`BINGO progress ${count} of 5`}>
      {letters.map((l, i) => (
        <div key={l} className={`w-8 h-8 flex items-center justify-center rounded ${i < count ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{l}</div>
      ))}
    </div>
  );
}

function Board({ board, marked, canClick, onPick }) {
  return (
    <div className="grid grid-cols-5 gap-2" role="grid" aria-label="Bingo board">
      {board?.flatMap((row, i) => row.map((num, j) => {
        const isMarked = marked?.[i]?.[j];
        return (
          <button
            key={`${i}-${j}-${num}`}
            role="gridcell"
            aria-pressed={!!isMarked}
            onClick={() => canClick && onPick(num)}
            className={`px-3 py-4 rounded-lg border text-lg font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition 
            ${isMarked ? 'bg-gray-300 line-through text-gray-600' : canClick ? 'bg-white hover:bg-gray-100' : 'bg-white'}`}
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Realtime Bingo (WebSockets)</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={createRoom} className="px-3 py-2 bg-indigo-600 text-white rounded">Create Room</button>
            <input ref={roomInputRef} placeholder="ROOM ID" className="px-2 py-2 border rounded" aria-label="Room ID"/>
            <button onClick={joinRoom} className="px-3 py-2 bg-green-600 text-white rounded">Join Room</button>
            <button onClick={restart} className="px-3 py-2 bg-red-500 text-white rounded">Restart</button>
          </div>
        </header>

        <div className="mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>Room: <strong>{roomId || '-'}</strong></div>
            <div>Role: <strong>{playerRole || '-'}</strong></div>
            <div>Turn: <strong>{state?.turn || '-'}</strong></div>
          </div>
        </div>

        {!state && (
          <div className="p-6 bg-white rounded shadow text-center">
            <p className="text-gray-600">Create or join a room to start. Share the room ID with the other player.</p>
          </div>
        )}

        {state && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`p-4 bg-white rounded shadow ${state.turn === 'P1' ? 'ring-2 ring-indigo-400' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Player 1</h2>
                <BingoLetters count={state.lettersP1} />
              </div>
              <Board board={state.boardP1} marked={state.markedP1} canClick={playerRole === 'P1'} onPick={pickNumber} />
            </div>
            <div className={`p-4 bg-white rounded shadow ${state.turn === 'P2' ? 'ring-2 ring-indigo-400' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Player 2</h2>
                <BingoLetters count={state.lettersP2} />
              </div>
              <Board board={state.boardP2} marked={state.markedP2} canClick={playerRole === 'P2'} onPick={pickNumber} />
            </div>
          </div>
        )}

        {state?.finished && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6">
            <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center shadow-xl">
              <h3 className="text-xl font-bold mb-2">Winner</h3>
              <p className="text-2xl font-semibold mb-4">{winnerText}</p>
              <button onClick={restart} className="px-4 py-2 bg-indigo-600 text-white rounded">Restart</button>
            </div>
          </div>
        )}

        <footer className="mt-8 text-sm text-gray-500">
          Note: Server holds room state in memory. For production, add persistence/auth.
        </footer>
      </div>
    </div>
  );
}


