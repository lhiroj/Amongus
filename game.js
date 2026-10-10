// --- OYUN DURUMU VE YAPILANDIRMA ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let gameState = 'MENU'; // MENU, GAME
let animationFrameId = null;

// Dünya ve Harita Boyutları
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1800;

// Oyuncu Ayarları
const player = {
    x: 1200,
    y: 900,
    radius: 22,
    speed: 3.5,
    color: '#0051ff',
    name: 'Kaptan',
    vx: 0,
    vy: 0,
    facing: 'right'
};

// Kamera
const camera = {
    x: 0,
    y: 0,
    update() {
        camera.x = player.x - canvas.width / 2;
        camera.y = player.y - canvas.height / 2;
        
        // Sınırları koru
        camera.x = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, camera.x));
        camera.y = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, camera.y));
    }
};

// Harita Odaları ve Duvarlar (Çarpışma Sınırları)
const walls = [
    // Dış Sınırlar
    { x: 0, y: 0, w: WORLD_WIDTH, h: 40 },
    { x: 0, y: WORLD_HEIGHT - 40, w: WORLD_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: WORLD_HEIGHT },
    { x: WORLD_WIDTH - 40, y: 0, w: 40, h: WORLD_HEIGHT },
    
    // İç Duvarlar / Odalar (Örn: Komuta, Elektrik, Motor vb.)
    { x: 200, y: 200, w: 500, h: 400 }, // Komuta Odası
    { x: 900, y: 200, w: 600, h: 400 }, // Laboratuvar
    { x: 1700, y: 200, w: 500, h: 400 }, // Motor Odası
    { x: 200, y: 800, w: 500, h: 400 }, // Medikal
    { x: 900, y: 800, w: 600, h: 400 }, // Depo / Kafe
    { x: 1700, y: 800, w: 500, h: 400 }, // Elektrik Odası
    { x: 500, y: 1400, w: 1400, h: 300 } // Haberleşme & Oksijen
];

// --- SANAL JOYSTICK KONTROL SİSTEMİ ---
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

let joystick = {
    active: false,
    identifier: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    maxRadius: 45,
    powerX: 0,
    powerY: 0
};

joystickBase.addEventListener('pointerdown', (e) => {
    joystick.active = true;
    joystick.identifier = e.pointerId;
    const rect = joystickBase.getBoundingClientRect();
    joystick.startX = rect.left + rect.width / 2;
    joystick.startY = rect.top + rect.height / 2;
    updateJoystick(e.clientX, e.clientY);
    joystickBase.setPointerCapture(e.pointerId);
});

joystickBase.addEventListener('pointermove', (e) => {
    if (!joystick.active || e.pointerId !== joystick.identifier) return;
    updateJoystick(e.clientX, e.clientY);
});

function endJoystick(e) {
    if (!joystick.active || e.pointerId !== joystick.identifier) return;
    joystick.active = false;
    joystick.identifier = null;
    joystick.powerX = 0;
    joystick.powerY = 0;
    joystickStick.style.transform = `translate(0px, 0px)`;
}

joystickBase.addEventListener('pointerup', endJoystick);
joystickBase.addEventListener('pointercancel', endJoystick);

function updateJoystick(clientX, clientY) {
    const dx = clientX - joystick.startX;
    const dy = clientY - joystick.startY;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    
    let clampedDistance = Math.min(distance, joystick.maxRadius);
    const moveX = Math.cos(angle) * clampedDistance;
    const moveY = Math.sin(angle) * clampedDistance;
    
    joystickStick.style.transform = `translate(${moveX}px, ${moveY}px)`;
    
    joystick.powerX = moveX / joystick.maxRadius;
    joystick.powerY = moveY / joystick.maxRadius;
}

// --- KLAVYE DESTEĞİ (YEDEK) ---
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'W') keys.w = true;
    if (e.key === 'a' || e.key === 'A') keys.a = true;
    if (e.key === 's' || e.key === 'S') keys.s = true;
    if (e.key === 'd' || e.key === 'D') keys.d = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W') keys.w = false;
    if (e.key === 'a' || e.key === 'A') keys.a = false;
    if (e.key === 's' || e.key === 'S') keys.s = false;
    if (e.key === 'd' || e.key === 'D') keys.d = false;
});

// --- ÇARPIŞMA KONTROLÜ (AABB) ---
function checkCollision(nx, ny) {
    for (let wall of walls) {
        if (
            nx + player.radius > wall.x &&
            nx - player.radius < wall.x + wall.w &&
            ny + player.radius > wall.y &&
            ny - player.radius < wall.y + wall.h
        ) {
            return true;
        }
    }
    return false;
}

// --- OYUN DÖNGÜSÜ ---
function update() {
    if (gameState !== 'GAME') return;

    let moveX = joystick.powerX;
    let moveY = joystick.powerY;

    // Klavye girdisi ekleme
    if (keys.a) moveX = -1;
    if (keys.d) moveX = 1;
    if (keys.w) moveY = -1;
    if (keys.s) moveY = 1;

    // Vektör Normalizasyonu (Çapraz hız eşitleme)
    let len = Math.hypot(moveX, moveY);
    if (len > 1) {
        moveX /= len;
        moveY /= len;
    }

    player.vx = moveX * player.speed;
    player.vy = moveY * player.speed;

    if (player.vx !== 0 || player.vy !== 0) {
        if (player.vx > 0) player.facing = 'right';
        if (player.vx < 0) player.facing = 'left';
    }

    // X Ekseni Hareket ve Çarpışma
    let nextX = player.x + player.vx;
    if (!checkCollision(nextX, player.y)) {
        player.x = nextX;
    }

    // Y Ekseni Hareket ve Çarpışma
    let nextY = player.y + player.vy;
    if (!checkCollision(player.x, nextY)) {
        player.y = nextY;
    }

    camera.update();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState !== 'GAME') return;

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 1. Zemin (Metalik Uzay Gemisi Döşemesi)
    ctx.fillStyle = '#101622';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Grid Çizgileri
    ctx.strokeStyle = '#182233';
    ctx.lineWidth = 1;
    const gridSize = 80;
    for (let x = 0; x <= WORLD_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_WIDTH, y);
        ctx.stroke();
    }

    // 2. Odalar ve Duvarlar
    for (let wall of walls) {
        ctx.fillStyle = '#1e2d45';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.strokeStyle = '#2d446b';
        ctx.lineWidth = 4;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }

    // 3. Oyuncu Karakteri Çizimi
    ctx.save();
    ctx.translate(player.x, player.y);

    // Gölge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(0, player.radius + 2, player.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Gövde
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    // Vizör (Kask Camı)
    ctx.fillStyle = '#aae6ff';
    ctx.beginPath();
    let visorOffsetX = player.facing === 'right' ? 6 : -6;
    ctx.ellipse(visorOffsetX, -2, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Oyuncu İsmi
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, 0, -player.radius - 8);

    ctx.restore();
    ctx.restore();
}

function gameLoop() {
    update();
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- EKRAN VE BOYUT YÖNETİMİ ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- MENÜ ETKİLEŞİMLERİ ---
const mainMenu = document.getElementById('main-menu');
const gameContainer = document.getElementById('game-container');
const modalHowTo = document.getElementById('modal-how-to');
const modalSettings = document.getElementById('modal-settings');

document.getElementById('btn-play').addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    gameState = 'GAME';
    if (!animationFrameId) {
        gameLoop();
    }
});

document.getElementById('btn-how-to').addEventListener('click', () => {
    modalHowTo.classList.remove('hidden');
});
document.getElementById('close-how-to').addEventListener('click', () => {
    modalHowTo.classList.add('hidden');
});

document.getElementById('btn-settings').addEventListener('click', () => {
    modalSettings.classList.remove('hidden');
});
document.getElementById('close-settings').addEventListener('click', () => {
    player.name = document.getElementById('player-name-input').value || 'Kaptan';
    player.color = document.getElementById('player-color-select').value;
    document.getElementById('player-hud-name').textContent = player.name;
    modalSettings.classList.add('hidden');
});
