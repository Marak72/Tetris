const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Tetromino definitions
const TETROMINOS = {
    'I': { shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], color: '#00f0f0' },
    'J': { shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], color: '#0000f0' },
    'L': { shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], color: '#f0a000' },
    'O': { shape: [[1, 1], [1, 1]], color: '#f0f000' },
    'S': { shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], color: '#00f000' },
    'T': { shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], color: '#a000f0' },
    'Z': { shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], color: '#f00000' }
};

const ROOMS = {};

function createRoom(roomId, settings) {
    console.log(`[Room ${roomId}] Creating room with settings:`, settings);
    const width = settings.width || 15;
    const height = settings.height || 20;
    ROOMS[roomId] = {
        id: roomId,
        width,
        height,
        mode: settings.mode || 'co-op',
        board: Array.from({ length: height }, () => Array(width).fill(0)),
        players: {}, 
        status: 'waiting', 
        interval: null,
        countdownInterval: null,
        countdown: 3
    };
}

function getRandomPiece(width, playerIndex = 0) {
    const keys = Object.keys(TETROMINOS);
    const type = keys[Math.floor(Math.random() * keys.length)];
    const piece = JSON.parse(JSON.stringify(TETROMINOS[type]));
    
    let xOffset = 0;
    if (playerIndex === 0) xOffset = -Math.floor(width / 4);
    else if (playerIndex === 1) xOffset = Math.floor(width / 4);

    return {
        ...piece,
        type,
        x: Math.floor(width / 2) - Math.floor(piece.shape[0].length / 2) + xOffset,
        y: 0
    };
}

function rotateMatrix(matrix) {
    return matrix[0].map((_, index) => matrix.map(row => row[index]).reverse());
}

function checkCollision(board, piece, moveX, moveY, otherPiece = null) {
    for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
            if (piece.shape[y][x]) {
                const newX = piece.x + x + moveX;
                const newY = piece.y + y + moveY;

                // Boundaries
                if (newX < 0 || newX >= board[0].length || newY >= board.length) return true;
                
                // Board (blocks)
                if (newY >= 0 && board[newY][newX]) return true;

                // Other active piece
                if (otherPiece) {
                    for (let oy = 0; oy < otherPiece.shape.length; oy++) {
                        for (let ox = 0; ox < otherPiece.shape[oy].length; ox++) {
                            if (otherPiece.shape[oy][ox]) {
                                if (newX === otherPiece.x + ox && newY === otherPiece.y + oy) return true;
                            }
                        }
                    }
                }
            }
        }
    }
    return false;
}

function lockPiece(room, socketId) {
    const player = room.players[socketId];
    if (!player || !player.piece) return;

    console.log(`[Room ${room.id}] Locking piece for player ${player.name}`);
    player.piece.shape.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value) {
                const boardY = player.piece.y + y;
                const boardX = player.piece.x + x;
                if (boardY >= 0 && boardY < room.height && boardX >= 0 && boardX < room.width) {
                    room.board[boardY][boardX] = player.piece.color;
                }
            }
        });
    });

    const linesCleared = clearLines(room);
    if (linesCleared > 0) {
        if (room.mode === 'versus') {
            const opponentId = Object.keys(room.players).find(id => id !== socketId);
            if (opponentId && linesCleared > 1) addGarbage(room, opponentId, linesCleared - 1);
        }
        player.score += linesCleared * 100;
    }

    const newPiece = getRandomPiece(room.width, player.index);
    
    const otherId = Object.keys(room.players).find(id => id !== socketId);
    const otherPiece = otherId ? room.players[otherId].piece : null;
    
    if (checkCollision(room.board, newPiece, 0, 0, otherPiece)) {
        console.log(`[Room ${room.id}] Game Over triggered by player ${player.name} piece spawn`);
        room.status = 'gameover';
        player.piece = null; // Prevent double drawing on game over
        if (room.interval) clearInterval(room.interval);
        io.to(room.id).emit('gameover', { winner: null });
    } else {
        player.piece = newPiece;
    }
}

function clearLines(room) {
    let linesCleared = 0;
    const clearedIndices = [];
    const clearedColors = [];
    for (let y = room.height - 1; y >= 0; y--) {
        if (room.board[y].every(cell => cell !== 0)) {
            clearedIndices.push(y);
            clearedColors.push([...room.board[y]]);
            room.board.splice(y, 1);
            room.board.unshift(Array(room.width).fill(0));
            linesCleared++;
            y++;
        }
    }
    if (linesCleared > 0) {
        io.to(room.id).emit('linesCleared', { 
            yLines: clearedIndices, 
            boardWidth: room.width,
            colors: clearedColors
        });
    }
    return linesCleared;
}

function addGarbage(room, targetSocketId, lines) {
    for (let i = 0; i < lines; i++) {
        const garbageLine = Array(room.width).fill('#888');
        garbageLine[Math.floor(Math.random() * room.width)] = 0;
        room.board.shift();
        room.board.push(garbageLine);
    }
    Object.values(room.players).forEach(p => {
        if (p.piece) {
            while (checkCollision(room.board, p.piece, 0, 0)) p.piece.y--;
        }
    });
}

function startGame(room) {
    console.log(`[Room ${room.id}] Starting countdown...`);
    room.status = 'countdown';
    room.countdown = 3;
    room.board = Array.from({ length: room.height }, () => Array(room.width).fill(0));
    
    Object.keys(room.players).forEach((id) => {
        const player = room.players[id];
        player.score = 0;
        player.piece = getRandomPiece(room.width, player.index);
    });

    if (room.countdownInterval) clearInterval(room.countdownInterval);
    room.countdownInterval = setInterval(() => {
        io.to(room.id).emit('countdown', room.countdown);
        console.log(`[Room ${room.id}] Countdown: ${room.countdown}`);
        
        if (room.countdown <= 0) {
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
            console.log(`[Room ${room.id}] Game started!`);
            room.status = 'playing';
            if (room.interval) clearInterval(room.interval);
            room.interval = setInterval(() => update(room), 500);
        }
        room.countdown--;
    }, 1000);
}

function update(room) {
    if (room.status !== 'playing') return;

    const playerIds = Object.keys(room.players);
    playerIds.forEach(id => {
        const player = room.players[id];
        const otherId = playerIds.find(pid => pid !== id);
        const otherPiece = otherId ? room.players[otherId].piece : null;

        if (!player.piece) return;

        if (checkCollision(room.board, player.piece, 0, 1, null)) {
            lockPiece(room, id);
        } else if (!checkCollision(room.board, player.piece, 0, 1, otherPiece)) {
            player.piece.y++;
        }
    });

    emitState(room);
}

function emitState(room) {
    io.to(room.id).emit('gameState', {
        board: room.board,
        players: Object.keys(room.players).reduce((acc, id) => {
            acc[id] = {
                piece: room.players[id].piece,
                score: room.players[id].score,
                name: room.players[id].name,
                ready: room.players[id].ready
            };
            return acc;
        }, {}),
        status: room.status
    });
}

io.on('connection', (socket) => {
    console.log(`[Socket ${socket.id}] Connected`);

    socket.on('joinRoom', ({ roomId, settings, name }) => {
        if (!ROOMS[roomId]) createRoom(roomId, settings);
        const room = ROOMS[roomId];
        
        if (Object.keys(room.players).length >= 2) {
            return socket.emit('error', 'Room is full');
        }

        socket.join(roomId);
        
        // Find first available index (0 or 1)
        const indices = Object.values(room.players).map(p => p.index);
        const playerIndex = indices.includes(0) ? 1 : 0;

        room.players[socket.id] = {
            name: name || `Player ${Object.keys(room.players).length + 1}`,
            score: 0,
            piece: null,
            ready: false,
            index: playerIndex
        };
        console.log(`[Room ${roomId}] Player ${room.players[socket.id].name} joined`);
        emitState(room);
    });

    socket.on('ready', ({ roomId }) => {
        const room = ROOMS[roomId];
        if (!room || !room.players[socket.id]) return;
        
        room.players[socket.id].ready = true;
        console.log(`[Room ${roomId}] Player ${room.players[socket.id].name} is ready`);
        
        const allReady = Object.values(room.players).every(p => p.ready);
        if (allReady && Object.keys(room.players).length === 2 && room.status === 'waiting') {
            startGame(room);
        } else {
            emitState(room);
        }
    });

    socket.on('move', ({ roomId, dir }) => {
        const room = ROOMS[roomId];
        if (!room || room.status !== 'playing') return;
        const player = room.players[socket.id];
        if (!player || !player.piece) return;

        const otherId = Object.keys(room.players).find(id => id !== socket.id);
        const otherPiece = otherId ? room.players[otherId].piece : null;

        if (dir === 'left') {
            if (!checkCollision(room.board, player.piece, -1, 0, otherPiece)) player.piece.x--;
        } else if (dir === 'right') {
            if (!checkCollision(room.board, player.piece, 1, 0, otherPiece)) player.piece.x++;
        } else if (dir === 'down') {
            if (checkCollision(room.board, player.piece, 0, 1, null)) {
                lockPiece(room, socket.id);
            } else if (!checkCollision(room.board, player.piece, 0, 1, otherPiece)) {
                player.piece.y++;
            }
        } else if (dir === 'rotate') {
            const rotated = rotateMatrix(player.piece.shape);
            const originalShape = player.piece.shape;
            player.piece.shape = rotated;
            if (checkCollision(room.board, player.piece, 0, 0, otherPiece)) {
                player.piece.shape = originalShape;
            }
        }
        emitState(room);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket ${socket.id}] Disconnected`);
        for (const roomId in ROOMS) {
            const room = ROOMS[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    if (room.interval) clearInterval(room.interval);
                    if (room.countdownInterval) clearInterval(room.countdownInterval);
                    delete ROOMS[roomId];
                } else {
                    room.status = 'waiting';
                    if (room.interval) clearInterval(room.interval);
                    if (room.countdownInterval) clearInterval(room.countdownInterval);
                    room.countdownInterval = null;
                    Object.values(room.players).forEach(p => p.ready = false);
                    emitState(room);
                }
            }
        }
    });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
