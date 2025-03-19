import { useState, useEffect } from 'react'
import { Room } from './components/Room'
import { Game } from './components/Game'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from './config/firebase';
import './App.css'

interface GameState {
  roomId: string;
  playerId: string;
  playerName: string;
}

// Updated interface for the intermediate state
interface WaitingState {
  roomId: string;
  playerId: string;
  isCreator: boolean;
  opponentJoined: boolean;
}

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [waitingState, setWaitingState] = useState<WaitingState | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [nameError, setNameError] = useState(false);

  const handleJoinRoom = (roomId: string, playerId: string, isCreator: boolean) => {
    setWaitingState({ 
      roomId, 
      playerId, 
      isCreator,
      opponentJoined: false
    });
  };

  const handleNameSubmit = async () => {
    if (waitingState) {
      let name = playerName.trim();
      
      // For opponent (joiner), auto-generate name if empty
      if (!waitingState.isCreator && !name) {
        name = `Guest${Math.floor(Math.random() * 10000)}`;
      } 
      // For creator, require a name
      else if (waitingState.isCreator && !name) {
        setNameError(true);
        return;
      }
      
      // Update game state with player name
      if (waitingState.isCreator && !waitingState.opponentJoined) {
        // Just update player name, wait for opponent to join
        setPlayerName(name);
        setNameError(false);
        
        // Update Firebase with ready status
        try {
          await updateDoc(doc(db, 'rooms', waitingState.roomId), {
            creatorReady: true,
            creatorId: waitingState.playerId,
            creatorName: name
          });
        } catch (error) {
          console.error("Error updating creator status:", error);
        }
      } else {
        // Either opponent is joining or creator is starting after opponent joined
        
        try {
          // If creator is starting the game after opponent joined
          if (waitingState.isCreator && waitingState.opponentJoined) {
            // Update room status to playing
            await updateDoc(doc(db, 'rooms', waitingState.roomId), {
              status: 'playing',
              gameStarted: true
            });
          }
          
          // If opponent is joining, update room status
          if (!waitingState.isCreator) {
            await updateDoc(doc(db, 'rooms', waitingState.roomId), {
              opponentJoined: true,
              status: 'ready'
            });
          }
          
          // After Firebase update is successful, update local state
          setGameState({
            roomId: waitingState.roomId,
            playerId: waitingState.playerId,
            playerName: name
          });
          setWaitingState(null);
          
        } catch (error) {
          console.error("Error updating game status:", error);
        }
      }
    }
  };

  // Listen for opponent joining
  useEffect(() => {
    if (!waitingState || !waitingState.isCreator) return;

    const unsubscribe = onSnapshot(doc(db, 'rooms', waitingState.roomId), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        
        if (data.opponentJoined) {
          setWaitingState(prev => prev ? { ...prev, opponentJoined: true } : null);
        }
      }
    });

    return () => unsubscribe();
  }, [waitingState]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlayerName(e.target.value);
    if (nameError) setNameError(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    }
  };

  return (
    <div className="app">
      {gameState ? (
        <Game 
          roomId={gameState.roomId} 
          playerId={gameState.playerId} 
          playerName={gameState.playerName}
        />
      ) : waitingState ? (
        <div className="name-popup-overlay">
          <div className="name-popup">
            {waitingState.isCreator ? (
              <>
                <h2>Waiting Room</h2>
                <p className="room-id-display">Room ID: {waitingState.roomId}</p>
                <p>Share this Room ID with your friend</p>
                
                {!waitingState.opponentJoined ? (
                  <>
                    <div className="name-input-group">
                      <input
                        type="text"
                        placeholder="Your name"
                        value={playerName}
                        onChange={handleNameChange}
                        onKeyPress={handleKeyPress}
                        maxLength={15}
                        autoFocus
                        className={nameError ? 'error' : ''}
                      />
                      {nameError && <p className="name-error">Please enter your name</p>}
                      
                      <div className="waiting-status">
                        <div className="loading-spinner"></div>
                        <p>Waiting for opponent to join...</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="success-message">Opponent has joined!</p>
                    <button 
                      className="name-submit-button"
                      onClick={handleNameSubmit}
                    >
                      Start Game
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <h2>Join Game</h2>
                <p>Joining room: {waitingState.roomId}</p>
                
                <div className="name-input-group">
                  <input
                    type="text"
                    placeholder="Your name (optional)"
                    value={playerName}
                    onChange={handleNameChange}
                    onKeyPress={handleKeyPress}
                    maxLength={15}
                    autoFocus
                  />
                  <p className="hint-text">Leave empty for random guest name</p>
                  
                  <button 
                    className="name-submit-button"
                    onClick={handleNameSubmit}
                  >
                    Join Game
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <Room onJoinRoom={handleJoinRoom} />
      )}
    </div>
  );
}

export default App
