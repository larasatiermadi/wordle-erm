# Multiplayer Wordle

A real-time multiplayer version of the popular Wordle game where you can play against friends by sharing a room ID.

## Features

- Real-time multiplayer gameplay
- Room-based system for playing with friends
- Live opponent progress tracking (colors only)
- Modern UI with Chakra UI
- Responsive design

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a Firebase project and enable Firestore
4. Copy your Firebase configuration to `src/config/firebase.ts`
5. Start the development server:
   ```bash
   npm run dev
   ```

## How to Play

1. Open the game in your browser
2. Click "Create New Room" to start a new game
3. Share the Room ID with your friend
4. Your friend can join by entering the Room ID
5. Start playing! You'll see each other's progress in real-time

## Technologies Used

- React
- TypeScript
- Firebase (Firestore)
- Chakra UI
- Vite
