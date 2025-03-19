import React, { useState } from 'react';
import { collection, addDoc, doc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../config/firebase';

interface RoomProps {
  onJoinRoom: (roomId: string, playerId: string, isCreator: boolean) => void;
}

export const Room: React.FC<RoomProps> = ({ onJoinRoom }) => {
  const [roomId, setRoomId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const createRoom = async () => {
    setIsCreating(true);
    setError('');
    try {
      const playerId = Math.random().toString(36).substring(7);
      const roomRef = await addDoc(collection(db, 'rooms'), {
        createdAt: new Date(),
        players: [playerId],
        status: 'waiting',
        opponentJoined: false
      });
      
      // Pass true as isCreator flag
      onJoinRoom(roomRef.id, playerId, true);
    } catch (error) {
      setError('Error creating room. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const joinRoom = async () => {
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }

    setError('');
    try {
      const playerId = Math.random().toString(36).substring(7);
      const roomRef = doc(db, 'rooms', roomId);
      
      await setDoc(roomRef, {
        players: arrayUnion(playerId),
        // Don't change status to 'playing' yet, this happens after name input
        opponentId: playerId
      }, { merge: true });

      // Pass false as isCreator flag
      onJoinRoom(roomId, playerId, false);
    } catch (error) {
      setError('Error joining room. Please check the room ID and try again.');
    }
  };

  return (
    <div className="room-container">
      <h1 className="title">WORDLE</h1>
      <p>Play with friends in real-time</p>
      
      <button 
        className="room-button blue-button"
        onClick={createRoom}
        disabled={isCreating}
      >
        {isCreating ? 'Creating...' : 'Create New Room'}
      </button>

      <p>or</p>

      <div className="room-join-container">
        <input
          className="room-input"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button
          className="room-button green-button"
          onClick={joinRoom}
        >
          Join Room
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
    </div>
  );
}; 