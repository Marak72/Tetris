const socket = io();

const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('game-container');
const canvas = document.getElementById('tetris-canvas');
const ctx = canvas.getContext('2d');
const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const boardSizeSelect = document.getElementById('board-size');
const gameModeSelect = document.getElementById('game-mode');
const statusDiv = document.getElementById('status');
const playersListDiv = document.getElementById('players-list');
const currentRoomIdSpan = document.getElementById('current-room-id');
const gameOverOverlay = document.getElementById('game-over-overlay');
const countdownOverlay = document.getElementById('countdown-overlay');

const maxPlayersSelect = document.getElementById('max-players');
const nextPiecesGrid = document.getElementById('next-pieces-grid');

const TETROMINOS = {
    'I': { shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], color: '#00f0f0' },
    'J': { shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], color: '#0000f0' },
    'L': { shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], color: '#f0a000' },
    'O': { shape: [[1, 1], [1, 1]], color: '#f0f000' },
    'S': { shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], color: '#00f000' },
    'T': { shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], color: '#a000f0' },
    'Z': { shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], color: '#f00000' }
};

let BLOCK_SIZE = 30;
let currentRoomId = '';
let particles = [];
let explodingLines = [];
let shakeTime = 0;

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * 5 + 2;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.vy += 0.2; // Gravity
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.restore();
    }
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
        particles.push(new Particle(
            x * BLOCK_SIZE + BLOCK_SIZE / 2,
            y * BLOCK_SIZE + BLOCK_SIZE / 2,
            color
        ));
    }
}

socket.on('linesCleared', (data) => {
    const { yLines, boardWidth, colors } = data;
    shakeTime = 15;
    yLines.forEach((y, index) => {
        const rowColors = colors ? colors[index] : Array(boardWidth).fill('#fff');
        // Add to animating lines
        explodingLines.push({
            y: y,
            colors: rowColors,
            life: 1.0,
            boardWidth: boardWidth
        });
        
        for (let x = 0; x < boardWidth; x++) {
            createExplosion(x, y, rowColors[x] || '#fff');
        }
    });
});

function animate() {
    ctx.save();
    
    // Screen shake
    if (shakeTime > 0) {
        const sx = (Math.random() - 0.5) * 15;
        const sy = (Math.random() - 0.5) * 15;
        ctx.translate(sx, sy);
        shakeTime--;
    }

    ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);
    
    if (lastState) {
        draw(lastState.board, lastState.players);
    }

    // Draw disappearing lines
    explodingLines = explodingLines.filter(l => l.life > 0);
    explodingLines.forEach(l => {
        l.life -= 0.04;
        drawExplodingLine(l);
    });

    // Update and draw particles
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.update();
        p.draw();
    });

    ctx.restore();
    requestAnimationFrame(animate);
}

function drawExplodingLine(line) {
    const alpha = line.life;
    const isFlash = line.life > 0.7;

    line.colors.forEach((color, x) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        if (isFlash) {
            drawBlock(x, line.y, '#fff', false);
        } else {
            drawBlock(x, line.y, color, false);
        }
        ctx.restore();
    });
}

let lastState = null;

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    const width = parseInt(boardSizeSelect.value);
    const mode = gameModeSelect.value;
    const maxPlayers = maxPlayersSelect.value;

    if (!roomId) return alert('Введите ID комнаты');

    currentRoomId = roomId;
    socket.emit('joinRoom', { roomId, name: username, settings: { width, mode, maxPlayers } });

    lobby.style.display = 'none';
    gameContainer.style.display = 'flex';
    currentRoomIdSpan.textContent = roomId;
    
    animate();
});

readyBtn.addEventListener('click', () => {
    socket.emit('ready', { roomId: currentRoomId });
    readyBtn.disabled = true;
    readyBtn.textContent = 'ГОТОВ (ЖДЕМ...)';
});

socket.on('gameState', (state) => {
    const { board, players, status } = state;
    lastState = state;
    
    const width = board[0].length;
    const height = board.length;
    
    if (canvas.width !== width * BLOCK_SIZE || canvas.height !== height * BLOCK_SIZE) {
        canvas.width = width * BLOCK_SIZE;
        canvas.height = height * BLOCK_SIZE;
    }

    if (status === 'playing') {
        statusDiv.textContent = 'ИГРАЕМ!';
        statusDiv.style.color = '#4caf50';
        readyBtn.style.display = 'none';
        countdownOverlay.style.display = 'none';
    } else if (status === 'waiting') {
        statusDiv.textContent = 'ОЖИДАНИЕ ИГРОКОВ...';
        statusDiv.style.color = '#ffc107';
        readyBtn.style.display = 'block';
        readyBtn.disabled = false;
        readyBtn.textContent = 'Я ГОТОВ';
    } else if (status === 'countdown') {
        statusDiv.textContent = 'ПРИГОТОВЬТЕСЬ!';
        statusDiv.style.color = '#007bff';
        readyBtn.style.display = 'none';
    }

    updatePlayersList(players);
    updateNextPieces(players);
});

function updateNextPieces(players) {
    nextPiecesGrid.innerHTML = '';
    for (const id in players) {
        const p = players[id];
        if (!p.piece || !p.piece.next) continue;

        const container = document.createElement('div');
        container.className = 'next-piece-item';
        
        const name = document.createElement('div');
        name.className = 'next-piece-name';
        name.textContent = p.name;
        if (id === socket.id) name.style.color = '#00f2ff';

        const nextCanvas = document.createElement('canvas');
        nextCanvas.className = 'next-piece-canvas';
        nextCanvas.width = 60;
        nextCanvas.height = 60;
        const nCtx = nextCanvas.getContext('2d');

        const piece = TETROMINOS[p.piece.next];
        const cellSize = 12;
        const offsetX = (nextCanvas.width - piece.shape[0].length * cellSize) / 2;
        const offsetY = (nextCanvas.height - piece.shape.length * cellSize) / 2;

        piece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    nCtx.fillStyle = piece.color;
                    nCtx.shadowBlur = 5;
                    nCtx.shadowColor = piece.color;
                    nCtx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize - 2, cellSize - 2);
                }
            });
        });

        container.appendChild(name);
        container.appendChild(nextCanvas);
        nextPiecesGrid.appendChild(container);
    }
}

socket.on('countdown', (count) => {
    countdownOverlay.style.display = 'block';
    countdownOverlay.textContent = count > 0 ? count : 'GO!';
});

socket.on('gameover', () => {
    gameOverOverlay.style.display = 'flex';
});

socket.on('error', (msg) => {
    alert(msg);
    location.reload();
});

function draw(board, players) {
    // Background with slight trail effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid with neon glow
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += BLOCK_SIZE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += BLOCK_SIZE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Board blocks
    board.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) drawBlock(x, y, value, false);
        });
    });

    // Players pieces
    for (const id in players) {
        const p = players[id];
        if (p.piece) {
            p.piece.shape.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value) drawBlock(p.piece.x + x, p.piece.y + y, p.piece.color, true);
                });
            });
        }
    }
}

function drawBlock(x, y, color, isGhost) {
    ctx.save();
    
    // Bloom/Glow effect
    ctx.shadowBlur = 15;
    ctx.shadowColor = color;
    
    ctx.fillStyle = color;
    if (isGhost) ctx.globalAlpha = 0.8;
    
    // Rounded block
    const r = 4;
    const px = x * BLOCK_SIZE + 2;
    const py = y * BLOCK_SIZE + 2;
    const s = BLOCK_SIZE - 4;
    
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + s - r, py);
    ctx.quadraticCurveTo(px + s, py, px + s, py + r);
    ctx.lineTo(px + s, py + s - r);
    ctx.quadraticCurveTo(px + s, py + s, px + s - r, py + s);
    ctx.lineTo(px + r, py + s);
    ctx.quadraticCurveTo(px, py + s, px, py + s - r);
    ctx.lineTo(px, py + r);
    ctx.quadraticCurveTo(px, py, px + r, py);
    ctx.closePath();
    ctx.fill();

    // Inner highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

function updatePlayersList(players) {
    playersListDiv.innerHTML = '<h3>Игроки:</h3>';
    for (const id in players) {
        const p = players[id];
        const div = document.createElement('div');
        div.className = 'player-item' + (p.ready ? ' ready' : '');
        div.innerHTML = `<strong>${p.name}</strong>: ${p.score} ${p.ready ? '✅' : '⏳'}`;
        if (id === socket.id) div.style.color = '#007bff';
        playersListDiv.appendChild(div);
    }
}

document.addEventListener('keydown', (e) => {
    if (!currentRoomId) return;
    let dir = null;
    if (e.key === 'ArrowLeft' || e.key === 'a') dir = 'left';
    else if (e.key === 'ArrowRight' || e.key === 'd') dir = 'right';
    else if (e.key === 'ArrowDown' || e.key === 's') dir = 'down';
    else if (e.key === 'ArrowUp' || e.key === 'w') dir = 'rotate';
    if (dir) socket.emit('move', { roomId: currentRoomId, dir });
});
