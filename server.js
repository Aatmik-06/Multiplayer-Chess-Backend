const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

let gameState = {
  chess: new Chess(),
  players: {},
  playerCount: 0,
  currentTurn: 'white',
  gameStarted: false
};

// Reset game state
function resetGame() {
  gameState.chess = new Chess();
  gameState.players = {};
  gameState.playerCount = 0;
  gameState.currentTurn = 'white';
  gameState.gameStarted = false;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Handle player joining
  socket.on('join-game', () => {
    if (gameState.playerCount >= 2) {
      socket.emit('game-full');
      return;
    }

    // Assign color to player
    const playerColor = gameState.playerCount === 0 ? 'white' : 'black';
    gameState.players[socket.id] = {
      color: playerColor,
      id: socket.id
    };
    gameState.playerCount++;

    // Join the game room
    socket.join('game-room');

    // Send player info
    socket.emit('player-assigned', {
      color: playerColor,
      gameState: {
        fen: gameState.chess.fen(),
        currentTurn: gameState.currentTurn,
        playerCount: gameState.playerCount,
        gameStarted: gameState.playerCount === 2
      }
    });

    // If two players, start the game
    if (gameState.playerCount === 2) {
      gameState.gameStarted = true;
      io.to('game-room').emit('game-start', {
        fen: gameState.chess.fen(),
        currentTurn: gameState.currentTurn
      });
    }

    // Broadcast player count update
    io.to('game-room').emit('player-count-update', {
      playerCount: gameState.playerCount,
      gameStarted: gameState.gameStarted
    });
  });

  // Handle moves
  socket.on('make-move', (moveData) => {
    const player = gameState.players[socket.id];
    
    if (!player || !gameState.gameStarted) {
      socket.emit('move-error', 'Game not started or player not found');
      return;
    }

    // Check if it's player's turn
    if (player.color !== gameState.currentTurn) {
      socket.emit('move-error', 'Not your turn');
      return;
    }

    try {
      // Validate and make move
      const move = gameState.chess.move({
        from: moveData.from,
        to: moveData.to,
        promotion: moveData.promotion || 'q'
      });

      if (move) {
        // Switch turn
        gameState.currentTurn = gameState.currentTurn === 'white' ? 'black' : 'white';

        // Broadcast move to all players
        io.to('game-room').emit('move-made', {
          move: move,
          fen: gameState.chess.fen(),
          currentTurn: gameState.currentTurn,
          gameOver: gameState.chess.isGameOver(),
          inCheck: gameState.chess.inCheck(),
          isCheckmate: gameState.chess.isCheckmate(),
          isDraw: gameState.chess.isDraw()
        });

        // Check for game over
        if (gameState.chess.isGameOver()) {
          let result = 'draw';
          if (gameState.chess.isCheckmate()) {
            result = gameState.chess.turn() === 'w' ? 'black' : 'white';
          }
          
          io.to('game-room').emit('game-over', {
            result: result,
            reason: gameState.chess.isCheckmate() ? 'checkmate' : 
                   gameState.chess.isDraw() ? 'draw' : 'game-over'
          });
        }
      } else {
        socket.emit('move-error', 'Invalid move');
      }
    } catch (error) {
      socket.emit('move-error', 'Invalid move format');
    }
  });

  // Handle new game request
  socket.on('new-game', () => {
    resetGame();
    io.to('game-room').emit('game-reset');
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    if (gameState.players[socket.id]) {
      delete gameState.players[socket.id];
      gameState.playerCount--;
      
      if (gameState.playerCount === 0) {
        resetGame();
      } else {
        gameState.gameStarted = false;
        io.to('game-room').emit('player-disconnected', {
          playerCount: gameState.playerCount,
          gameStarted: gameState.gameStarted
        });
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Chess server running on port ${PORT}`);
  console.log(`Connect frontend at http://localhost:3000`);
});