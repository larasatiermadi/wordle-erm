import React, { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, updateDoc, arrayUnion, deleteField, increment, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import wordData from '../data/words.json';

interface GameProps {
  roomId: string;
  playerId: string;
  playerName: string;
}

const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;
// Import words from the JSON file
const WORDS = wordData.words;
// Create a set of valid words for faster lookup
const VALID_WORDS = new Set(wordData.words);

export const Game: React.FC<GameProps> = ({ roomId, playerId, playerName }) => {
  const [targetWord, setTargetWord] = useState('');
  const [currentGuess, setCurrentGuess] = useState('');
  const [guesses, setGuesses] = useState<string[]>([]);
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost' | 'waiting' | 'draw'>('waiting');
  const [opponentGuesses, setOpponentGuesses] = useState<string[]>([]);
  const [opponentColors, setOpponentColors] = useState<string[][]>([]);
  const [keyboardStatuses, setKeyboardStatuses] = useState<{[key: string]: string}>({});
  const gameContainerRef = useRef<HTMLDivElement>(null);
  // Add states for scoring and opponent name
  const [yourScore, setYourScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [opponentName, setOpponentName] = useState('Opponent');
  // Add state to track if game is ready to start
  const [gameReady, setGameReady] = useState(false);
  // Add state to track opponent's game state
  const [opponentGameState, setOpponentGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  // Add state to track who won the round
  const [roundWinner, setRoundWinner] = useState<string | null>(null);
  // Add state to track agreement to play again
  const [playAgainVotes, setPlayAgainVotes] = useState<number>(0);
  const [playerVoted, setPlayerVoted] = useState<boolean>(false);
  // Track current game round
  const [gameRound, setGameRound] = useState<number>(1);
  // Add state to track when a game reset is in progress
  const [resettingGame, setResettingGame] = useState<boolean>(false);
  // Add a ref to track when a reset has been initiated to prevent double resets
  const resetInProgressRef = useRef<boolean>(false);
  
  // Show result popup immediately when either player finishes
  const [showResultPopup, setShowResultPopup] = useState<boolean>(false);
  // Add state for invalid word feedback
  const [invalidWord, setInvalidWord] = useState<boolean>(false);
  const [shakingRow, setShakingRow] = useState<boolean>(false);

  // Update Room status and store player name in Firebase when component mounts
  useEffect(() => {
    // Save player name and update game status
    const initializeGame = async () => {
      try {
        // First, update our own player name
        const updateData = {
          [`${playerId}Name`]: playerName,
          [`${playerId}Ready`]: true,
          status: 'ready'
        };
        
        await updateDoc(doc(db, 'rooms', roomId), updateData);
        console.log('Player name saved:', playerName);
        
        // Initialize game round if not already set
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await getDoc(roomRef);
        const roomData = roomSnap.data();
        
        // If the room has a gameRound, make sure we sync our local state with it
        if (roomData && roomData.gameRound) {
          console.log(`Initial room data - setting gameRound to ${roomData.gameRound}`);
          setGameRound(roomData.gameRound);
        } else if (roomData && !roomData.gameRound) {
          // Only set gameRound to 1 if it doesn't exist in Firebase
          await updateDoc(roomRef, { gameRound: 1 });
        }
        
        // Then listen for game status and opponent
      } catch (error) {
        console.error('Error initializing game:', error);
      }
    };
    
    if (playerName && roomId) {
      initializeGame();
    }
  }, [roomId, playerId, playerName]);

  // Monitor room for opponent and ready status
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        
        // Find opponent ID
        const opponent = data.players?.find((id: string) => id !== playerId);
        
        // Check if both players are ready or game is officially started
        const opponentReady = data[`${opponent}Ready`] === true;
        const selfReady = data[`${playerId}Ready`] === true;
        const gameStarted = data.gameStarted === true;
        
        if ((opponent && opponentReady && selfReady) || gameStarted) {
          // Both players are ready, start the game
          setGameReady(true);
          setGameState('playing');
          
          // Get opponent name
          if (data[`${opponent}Name`]) {
            setOpponentName(data[`${opponent}Name`]);
          } else if (data.creatorName && data.creatorId !== playerId) {
            setOpponentName(data.creatorName);
          }
          
          // Also update scores if available
          if (data[`${playerId}Score`] !== undefined) {
            setYourScore(data[`${playerId}Score`] || 0);
          }
          if (data[`${opponent}Score`] !== undefined) {
            setOpponentScore(data[`${opponent}Score`] || 0);
          }
          
          // Update Firebase game status to playing if not already done
          if (!gameStarted) {
            updateDoc(doc(db, 'rooms', roomId), {
              status: 'playing',
              gameStarted: true
            }).catch(error => {
              console.error("Error updating game status:", error);
            });
          }
        }
      }
    });

    return () => unsubscribe();
  }, [roomId, playerId]);

  // Set target word when game is ready
  useEffect(() => {
    if (!gameReady) return;
    
    // Set random word at game start
    const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    setTargetWord(randomWord);
    console.log("Target word:", randomWord); // For debugging
  }, [gameReady]);

  // Define resetGameForNewRound function first to avoid the dependency cycle
  const resetGameForNewRound = useCallback(() => {
    console.log("Executing resetGameForNewRound");
    
    // Prevent multiple reset attempts
    if (resetInProgressRef.current) {
      console.log("Reset already in progress, ignoring this request");
      return;
    }
    
    // Set our reset lock
    resetInProgressRef.current = true;
    
    // Show loading state and immediately hide result popup
    setResettingGame(true);
    setShowResultPopup(false); // Force hide popup right away
    
    // Add a safety timeout to clear the reset state if something goes wrong
    const safetyTimeoutId = setTimeout(() => {
      console.log("SAFETY TIMEOUT: Forcing reset state to clear after 10 seconds");
      resetInProgressRef.current = false;
      setResettingGame(false);
    }, 10000); // 10 second safety timeout
    
    // Update Firebase with a transaction to ensure atomicity
    const roomRef = doc(db, 'rooms', roomId);
    
    // First, get the current state to make reset decisions
    getDoc(roomRef).then((docSnap) => {
      if (docSnap.exists()) {
        // Generate a unique round ID (current time + random) to avoid collisions
        // This prevents multiple clients from fighting over what the next round should be
        const uniqueRoundId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100);
        
        console.log(`Updating room to unique round ID: ${uniqueRoundId}`);
        
        // Update to a completely new unique round number
        return updateDoc(roomRef, {
          gameRound: uniqueRoundId,
          // Reset votes immediately to prevent race conditions
          playAgainVotes: 0,
          // Also add a resetInProgress flag to the room so all clients can see it
          resetInProgress: true
        });
      }
    }).then(() => {
      console.log("Game round updated successfully");
      
      // Wait for clients to detect the round change before clearing game data
      setTimeout(() => {
        // Now clear all the game state fields
        updateDoc(roomRef, {
          [`${playerId}Guesses`]: deleteField(),
          [`${playerId}Colors`]: deleteField(),
          [`${playerId}GameState`]: deleteField(),
          [`${playerId}FinishTime`]: deleteField(),
          roundWinner: deleteField(),
          roundResult: deleteField(),
        }).then(() => {
          console.log("Player game data cleared");
          
          // Clear the resetInProgress flag from Firebase LAST
          setTimeout(() => {
            updateDoc(roomRef, {
              resetInProgress: false
            }).then(() => {
              console.log("Reset process complete, allowing transitions");
              
              // Additional safety - force result popup to be hidden
              setShowResultPopup(false);
              
              // MANUAL FORCE RESET - Set to false unconditionally
              setResettingGame(false);
              
              // Add debug log to track state transition
              console.log("FORCED resettingGame state to FALSE");
              
              // Release our reset lock after a delay to prevent immediate re-triggering
              setTimeout(() => {
                resetInProgressRef.current = false;
                console.log("Reset lock released, game should be fully playable now");
                
                // Clear safety timeout since we're done
                clearTimeout(safetyTimeoutId);
              }, 500);
            }).catch(error => {
              console.error("Error clearing resetInProgress flag:", error);
              // Force clear state even on error
              resetInProgressRef.current = false;
              setResettingGame(false);
              clearTimeout(safetyTimeoutId);
            });
          }, 1000);
        }).catch(error => {
          console.error("Error clearing player game data:", error);
          // Force clear state on error
          resetInProgressRef.current = false;
          setResettingGame(false);
          clearTimeout(safetyTimeoutId);
          
          // Try to clear the resetInProgress flag in Firebase
          updateDoc(roomRef, { resetInProgress: false }).catch(() => {
            // Silently ignore this error
          });
        });
      }, 1000);
    }).catch(error => {
      console.error("Error resetting game:", error);
      
      // Try to clear reset flag in case of error
      updateDoc(roomRef, {
        resetInProgress: false
      }).catch(() => {
        // Silently ignore this error
      });
      
      // Force result popup to be hidden even in error case
      setShowResultPopup(false);
      
      // MANUAL FORCE RESET - Set to false unconditionally even in error case
      setResettingGame(false);
      console.log("FORCED resettingGame state to FALSE due to error");
      
      // Release our reset lock on error
      resetInProgressRef.current = false;
      console.log("Reset lock released after error");
      
      // Clear safety timeout
      clearTimeout(safetyTimeoutId);
    });
  }, [roomId, playerId]);

  // Subscribe to opponent's moves and game state
  useEffect(() => {
    if (!gameReady) return;
    
    // Track last processed round to prevent loops
    let lastProcessedRound = gameRound;
    
    const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        const opponent = data.players?.find((id: string) => id !== playerId);
        if (opponent) {
          // Monitor the reset flag directly from Firebase - check this FIRST
          if (data.resetInProgress !== undefined) {
            console.log("Reset in progress state:", data.resetInProgress);
            
            // If Firebase says reset is complete (false), make sure our state reflects that
            if (data.resetInProgress === false && resettingGame) {
              console.log("FIREBASE says reset is complete, forcing our state to match");
              setResettingGame(false);
              setShowResultPopup(false);
              // Also clear our local ref
              resetInProgressRef.current = false;
            } else if (data.resetInProgress === true) {
              // Force these UI states when in reset mode
              setResettingGame(true);
              setShowResultPopup(false);
              // Also set the local ref to prevent duplicate resets
              resetInProgressRef.current = true;
            }
          }
          
          // Update opponent guesses
          setOpponentGuesses(data[`${opponent}Guesses`] || []);
          
          // Parse the colors strings back to arrays
          const colorStrings = data[`${opponent}Colors`] || [];
          const parsedColors = colorStrings.map((str: string) => str.split(','));
          setOpponentColors(parsedColors);
          
          // Get scores
          setYourScore(data[`${playerId}Score`] || 0);
          setOpponentScore(data[`${opponent}Score`] || 0);
          
          // Check for game round updates
          if (data.gameRound !== undefined) {
            const newRound = data.gameRound;
            
            // Check if we already processed this round in this render cycle
            if (newRound !== lastProcessedRound) {
              // Update tracking variable immediately to prevent loops
              lastProcessedRound = newRound;
              
              // Log proper comparison with last processed round
              console.log(`Game round changed from ${lastProcessedRound} to ${newRound}, deciding action...`);
              
              // If it's a new round, do a full reset
              if (newRound !== gameRound) {
                console.log(`New round ${newRound} != current ${gameRound}, resetting local game state`);
                
                // Update state immediately
                setGameRound(newRound);
                
                // Reset all game state
                setGuesses([]);
                setCurrentGuess('');
                setGameState('playing');
                setKeyboardStatuses({});
                setRoundWinner(null);
                setShowResultPopup(false); // Make sure to reset this
                setPlayerVoted(false);
                setOpponentGameState('playing');
                setPlayAgainVotes(0);
                
                // FORCE RESET our UI state regardless of other conditions
                setResettingGame(false);
                resetInProgressRef.current = false;
                
                // Get a new random word
                const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
                setTargetWord(randomWord);
                console.log("New target word for round", newRound, ":", randomWord);
              }
            }
          }
          
          // Check for opponent's game state
          if (data[`${opponent}GameState`]) {
            setOpponentGameState(data[`${opponent}GameState`]);
            
            // Show result popup if opponent finished the game AND we're not resetting
            if ((data[`${opponent}GameState`] === 'won' || data[`${opponent}GameState`] === 'lost') && 
                !resettingGame && !resetInProgressRef.current) {
              setShowResultPopup(true);
            }
            
            // Check for win/draw conditions
            checkRoundStatus(data[`${opponent}GameState`]);
          }
          
          // Track play again votes
          if (data.playAgainVotes !== undefined) {
            console.log("Firebase playAgainVotes updated:", data.playAgainVotes);
            
            // Store previous vote count to prevent duplicate game resets
            const prevVotes = playAgainVotes;
            setPlayAgainVotes(data.playAgainVotes);
            
            // If the opponent has voted, make sure our result popup is showing 
            // so we can see the vote UI - but ONLY if we're not in a reset state
            if (data.playAgainVotes > 0 && 
                (gameState === 'won' || gameState === 'lost' || gameState === 'draw') && 
                !resettingGame && !resetInProgressRef.current) {
              setShowResultPopup(true);
            }
            
            // Show resetting screen for both players immediately when votes reach 2
            if (data.playAgainVotes === 2) {
              setResettingGame(true);
            }
            
            // If both players voted to play again, reset the game
            // Only execute if we're transitioning to 2 votes to prevent multiple resets
            // AND no reset is currently in progress
            if (data.playAgainVotes === 2 && prevVotes !== 2 && !resetInProgressRef.current) {
              console.log("Both players voted to play again, resetting game");
              resetGameForNewRound();
            }
          }
        }
      }
    });

    // Add another safety mechanism: check periodically if the game is stuck in resetting state
    const resetCheckInterval = setInterval(() => {
      if (resettingGame || resetInProgressRef.current) {
        console.log("Reset state check: still in resetting state after interval");
        
        // Get current Firebase state to verify
        getDoc(doc(db, 'rooms', roomId)).then(snapshot => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            if (data.resetInProgress === false && (resettingGame || resetInProgressRef.current)) {
              console.log("SAFETY INTERVAL: Firebase shows reset complete but local state is stuck, forcing reset");
              setResettingGame(false);
              resetInProgressRef.current = false;
            }
          }
        });
      }
    }, 8000); // Check every 8 seconds

    return () => {
      unsubscribe();
      clearInterval(resetCheckInterval);
    };
  }, [roomId, playerId, gameReady, gameState, resetGameForNewRound, resettingGame, gameRound]);

  // Check round status when own or opponent's game state changes
  const checkRoundStatus = useCallback((opponentState: string) => {
    // Skip if we're not in an active game state
    if (gameState !== 'playing' && gameState !== 'won' && gameState !== 'lost') return;
    
    // Different scenarios:
    // 1. I won, opponent still playing -> I win the round
    // 2. I won, opponent won -> Who finished first wins
    // 3. I won, opponent lost -> I win the round
    // 4. I lost, opponent won -> Opponent wins the round
    // 5. I lost, opponent lost -> Draw
    // 6. I lost, opponent still playing -> Wait for opponent to finish

    if (gameState === 'won') {
      // I won
      if (opponentState === 'won') {
        // Both won - check timestamp (should be handled by the first to win)
      } else if (opponentState === 'lost') {
        // I won, opponent lost - I win
        setRoundWinner(playerName);
      }
      // If opponent is still playing, wait for them to finish
    } else if (gameState === 'lost') {
      // I lost
      if (opponentState === 'won') {
        // I lost, opponent won - they win
        setRoundWinner(opponentName);
      } else if (opponentState === 'lost') {
        // Both lost - draw
        setGameState('draw');
        setRoundWinner('Draw');
        
        updateDoc(doc(db, 'rooms', roomId), {
          roundResult: 'draw'
        }).catch(error => {
          console.error("Error updating round result:", error);
        });
      }
      // If opponent is still playing, wait for them to finish
    }
  }, [gameState, opponentName, playerName, roomId]);

  // Define submitGuess as useCallback to prevent recreation on each render
  const submitGuess = useCallback(() => {
    console.log("Submitting guess:", currentGuess);
    if (currentGuess.length !== WORD_LENGTH) {
      console.log("Word not long enough, not submitting");
      return;
    }
    if (guesses.length >= MAX_ATTEMPTS) {
      console.log("Max attempts reached, not submitting");
      return;
    }
    
    // Check if the word is valid
    if (!VALID_WORDS.has(currentGuess)) {
      console.log("Invalid word, not in dictionary");
      setInvalidWord(true);
      setShakingRow(true);
      
      // Reset shaking animation after a short delay
      setTimeout(() => {
        setShakingRow(false);
      }, 500);
      
      // Reset invalid word state after feedback duration
      setTimeout(() => {
        setInvalidWord(false);
      }, 1500);
      
      return;
    }
    
    const newGuesses = [...guesses, currentGuess];
    setGuesses(newGuesses);
    console.log("Guess submitted, new guesses:", newGuesses);

    // Calculate colors and update keyboard statuses
    const colors = calculateColors(currentGuess, targetWord);
    updateKeyboardStatuses(currentGuess, colors);

    // Update Firebase with new guess
    // Firebase doesn't support nested arrays with arrayUnion, so we need to handle it differently
    const updateData: Record<string, any> = {};
    updateData[`${playerId}Guesses`] = arrayUnion(currentGuess);
    
    // Convert colors array to a string to avoid nested arrays in Firestore
    const colorsString = colors.join(',');
    updateData[`${playerId}Colors`] = arrayUnion(colorsString);
    
    updateDoc(doc(db, 'rooms', roomId), updateData).catch(error => {
      console.error("Error updating Firebase:", error);
    });

    const currentTime = new Date().getTime();
    
    if (currentGuess === targetWord) {
      setGameState('won');
      setShowResultPopup(true); // Show result popup immediately
      
      // Update score and game state in Firebase
      const updateData: Record<string, any> = {
        [`${playerId}GameState`]: 'won',
        [`${playerId}FinishTime`]: currentTime
      };
      
      // If we won and opponent already lost, we win the round
      if (opponentGameState === 'lost') {
        updateData.roundWinner = playerName;
        updateData[`${playerId}Score`] = yourScore + 1;
        setYourScore(prevScore => prevScore + 1);
        setRoundWinner(playerName);
      }
      // If we won and opponent already won, the faster player wins
      else if (opponentGameState === 'won') {
        // This should be handled by the first player to win
      } 
      // If we won and opponent is still playing, wait for them
      else {
        // We'll update score once we know the outcome
      }
      
      updateDoc(doc(db, 'rooms', roomId), updateData).catch(error => {
        console.error("Error updating game state:", error);
      });
      
    } else if (newGuesses.length >= MAX_ATTEMPTS) {
      setGameState('lost');
      setShowResultPopup(true); // Show result popup immediately
      
      // Update game state in Firebase
      const updateData: Record<string, any> = {
        [`${playerId}GameState`]: 'lost',
        [`${playerId}FinishTime`]: currentTime
      };
      
      // If we lost and opponent already won, they win the round
      if (opponentGameState === 'won') {
        updateData.roundWinner = opponentName;
        updateData[`${playerId}Score`] = opponentScore + 1;
        setRoundWinner(opponentName);
      }
      // If we lost and opponent also lost, it's a draw
      else if (opponentGameState === 'lost') {
        updateData.roundResult = 'draw';
        setGameState('draw');
        setRoundWinner('Draw');
      }
      // If opponent is still playing, wait for them to finish
      
      updateDoc(doc(db, 'rooms', roomId), updateData).catch(error => {
        console.error("Error updating game state:", error);
      });
    }

    setCurrentGuess('');
  }, [
    currentGuess, 
    guesses, 
    targetWord, 
    roomId, 
    playerId, 
    gameState, 
    yourScore, 
    opponentScore, 
    opponentGameState, 
    playerName, 
    opponentName
  ]);

  // Define onKeyPress as useCallback
  const onKeyPress = useCallback((key: string) => {
    if (gameState !== 'playing') return;
    if (guesses.length >= MAX_ATTEMPTS) return; // Prevent more than 6 guesses

    if (key === 'Enter') {
      console.log("Enter key pressed from onKeyPress");
      submitGuess();
    } else if (key === 'Backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
    } else if (/^[A-Za-z]$/.test(key)) {
      if (currentGuess.length < WORD_LENGTH) {
        setCurrentGuess(prev => prev + key.toUpperCase());
      }
    }
  }, [gameState, guesses, currentGuess, submitGuess]);

  // Define keyboard event handler as useCallback
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    console.log("Key pressed:", e.key);
    
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent default form submission
      e.stopPropagation(); // Stop event propagation
      console.log("Physical Enter key pressed");
      submitGuess();
      return; // Stop here to prevent the next call to onKeyPress
    }
    
    onKeyPress(e.key);
  }, [onKeyPress, submitGuess]);

  useEffect(() => {
    // Set focus to game container to capture keyboard events
    if (gameContainerRef.current) {
      gameContainerRef.current.focus();
    }

    // Prevent form submission on enter key
    const preventEnterSubmit = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        return false;
      }
    };

    // Add keyboard event listeners
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', preventEnterSubmit, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', preventEnterSubmit, true);
    };
  }, [handleKeyDown]);

  const updateKeyboardStatuses = (guess: string, colors: string[]) => {
    const newStatuses = { ...keyboardStatuses };
    
    guess.split('').forEach((letter, i) => {
      const currentStatus = newStatuses[letter] || '';
      const newStatus = colors[i];
      
      // Only overwrite if the new status is better
      if (newStatus === 'correct' || 
          (newStatus === 'present' && currentStatus !== 'correct') ||
          (!currentStatus && newStatus === 'absent')) {
        newStatuses[letter] = newStatus;
      }
    });
    
    setKeyboardStatuses(newStatuses);
  };

  const calculateColors = (guess: string, target: string): string[] => {
    return guess.split('').map((letter, index) => {
      if (letter === target[index]) return 'correct';
      if (target.includes(letter)) return 'present';
      return 'absent';
    });
  };

  const renderBoard = (guessesArray: string[], isPlayer: boolean) => {
    const rows = [];
    
    // Render submitted guesses
    for (let i = 0; i < guessesArray.length; i++) {
      const guess = guessesArray[i];
      const colors = isPlayer ? calculateColors(guess, targetWord) : opponentColors[i] || [];
      
      rows.push(
        <div key={`row-${i}`} className="row">
          {guess.split('').map((letter, j) => (
            <div 
              key={`tile-${i}-${j}`} 
              className={`tile ${colors[j] || ''}`}
            >
              {/* Only show letters on player's own board */}
              {isPlayer ? letter : ''}
            </div>
          ))}
        </div>
      );
    }
    
    // If player's board, render current guess (only if we haven't reached max attempts)
    if (isPlayer && guesses.length < MAX_ATTEMPTS) {
      rows.push(
        <div key="current-row" className={`row ${shakingRow ? 'shake' : ''}`}>
          {currentGuess.split('').map((letter, j) => (
            <div key={`current-tile-${j}`} className="tile">
              {letter}
            </div>
          ))}
          {[...Array(WORD_LENGTH - currentGuess.length)].map((_, j) => (
            <div key={`empty-tile-${j}`} className="tile"></div>
          ))}
        </div>
      );
    }
    
    // Add empty rows to fill the board (make sure we don't exceed MAX_ATTEMPTS)
    const emptyRows = MAX_ATTEMPTS - rows.length;
    for (let i = 0; i < emptyRows; i++) {
      rows.push(
        <div key={`empty-row-${i}`} className="row">
          {[...Array(WORD_LENGTH)].map((_, j) => (
            <div key={`empty-tile-${i}-${j}`} className="tile"></div>
          ))}
        </div>
      );
    }
    
    return rows;
  };

  const renderKeyboard = () => {
    const keyboardRows = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace']
    ];

    return (
      <div className="keyboard">
        {keyboardRows.map((row, i) => (
          <div key={`kb-row-${i}`} className="keyboard-row">
            {row.map(key => (
              <div 
                key={`key-${key}`} 
                className={`key ${key.length > 1 ? 'wide' : ''} ${keyboardStatuses[key] || ''}`}
                onClick={() => {
                  console.log(`Clicked key: ${key}`);
                  if (key === 'Enter') {
                    submitGuess();
                  } else {
                    onKeyPress(key);
                  }
                }}
              >
                {key === 'Backspace' ? '⌫' : key}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Add a function to vote for play again
  const playAgain = useCallback(() => {
    // Prevent voting if game is already resetting or in a reset process
    if (playerVoted || resettingGame || resetInProgressRef.current) {
      console.log("Player already voted or game is resetting, skipping");
      return;
    }
    
    console.log("Play again clicked, setting playerVoted to true");
    setPlayerVoted(true);
    
    // Get current vote count first, then increment
    const roomRef = doc(db, 'rooms', roomId);
    
    // Check if reset is in progress before proceeding
    getDoc(roomRef).then((docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.resetInProgress) {
          console.log("Reset detected in Firebase, canceling vote");
          setPlayerVoted(false); // Revert our local state
          return;
        }
        
        // Update vote count in Firebase - use increment for atomic updates
        console.log("Incrementing playAgainVotes in Firebase");
        return updateDoc(roomRef, {
          playAgainVotes: increment(1)
        });
      }
    }).catch(error => {
      console.error("Error updating play again votes:", error);
      setPlayerVoted(false); // Reset if there was an error
    });
  }, [roomId, playerVoted, resettingGame]);

  // Get appropriate game over message based on state
  const getGameOverMessage = () => {
    if (gameState === 'won') {
      return roundWinner === playerName 
        ? "You Won!" 
        : roundWinner === opponentName
          ? `${opponentName} was faster!`
          : "You Guessed Correctly!";
    } else if (gameState === 'lost') {
      return roundWinner === opponentName
        ? `${opponentName} Won!`
        : roundWinner === 'Draw'
          ? "Draw - Both Failed!"
          : "Game Over!";
    } else if (gameState === 'draw') {
      return "Draw - Both Failed!";
    }
    return "Game Over!";
  };

  return (
    <div 
      className="game-container" 
      ref={gameContainerRef}
      tabIndex={0} // Make div focusable
      onKeyDown={(e) => {
        // This prevents default Enter behavior, but doesn't submit guesses
        // to avoid duplicate submissions
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      }}
    >
      {/* Background decorative elements */}
      <div className="background-decoration bg-circle-1"></div>
      <div className="background-decoration bg-circle-2"></div>
      
      {/* SHOW RESETTING SCREEN AS HIGHEST PRIORITY */}
      {resettingGame || resetInProgressRef.current ? (
        <div className="game-over" style={{ zIndex: 1000 }}>
          <div className="play-again-container">
            <div className="loading-spinner"></div>
            <p className="resetting-message">Starting new round...</p>
          </div>
        </div>
      ) : gameState === 'waiting' ? (
        <div className="game-waiting">
          <h2>Waiting for opponent...</h2>
          <div className="loading-spinner"></div>
        </div>
      ) : (
        <>
          <div className="game-header">
            <h1 className="title">WORDLE</h1>
            <div className="room-id">Room ID: {roomId}</div>
            
            {/* Score display with player names */}
            <div className="score-container">
              <div className="score">
                <span>{playerName}: {yourScore}</span>
                <span className="score-divider"></span>
                <span>{opponentName}: {opponentScore}</span>
              </div>
            </div>
            
            {/* Display invalid word message */}
            {invalidWord && (
              <div className="invalid-word-message">Not in word list</div>
            )}
          </div>
          
          <div className="game-content">
            <div className="multi-board">
              <div className="board-container">
                <h2>{playerName}'s Board</h2>
                <div className="board">
                  {renderBoard(guesses, true)}
                </div>
                {gameState !== 'playing' && (
                  <div className="player-status">
                    {gameState === 'won' ? 'Solved!' : gameState === 'lost' ? 'Failed!' : gameState === 'draw' ? 'Draw!' : ''}
                  </div>
                )}
              </div>
              
              <div className="board-container">
                <h2>{opponentName}'s Board</h2>
                <div className="board">
                  {renderBoard(opponentGuesses, false)}
                </div>
                {opponentGameState !== 'playing' && (
                  <div className="player-status opponent-status">
                    {opponentGameState === 'won' ? 'Solved!' : opponentGameState === 'lost' ? 'Failed!' : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="keyboard-container">
            {renderKeyboard()}
          </div>

          {/* Game result popup - ONLY show if not resetting */}
          {showResultPopup && !resettingGame && !resetInProgressRef.current && (
            <div className="game-over">
              <h2>{getGameOverMessage()}</h2>
              {(gameState === 'lost' || gameState === 'draw') && <p>The word was: {targetWord}</p>}
              {roundWinner === playerName && <p className="winner-message">You earned a point!</p>}
              
              <div className="play-again-container">
                <button 
                  className={`play-again-button ${playerVoted ? 'voted' : ''}`}
                  onClick={playAgain}
                  disabled={playerVoted || resettingGame || resetInProgressRef.current}
                >
                  {playerVoted ? 'Waiting for opponent...' : 'Play Again'}
                </button>
                <div className="vote-counter">
                  <span>{playAgainVotes}/2 players ready</span>
                  <div className="vote-progress">
                    <div 
                      className="vote-bar" 
                      style={{ width: `${(playAgainVotes / 2) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}; 