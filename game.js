
"use strict";

// 1. Firebase ayarları
const firebaseConfig = {
  apiKey: "BURAYA_API_KEY",
  authDomain: "BURAYA_AUTH_DOMAIN",
  databaseURL: "BURAYA_DATABASE_URL",
  projectId: "BURAYA_PROJECT_ID",
  appId: "BURAYA_APP_ID"
};

const MAX_PLAYERS = 4;
const WORLD_W = 960;
const WORLD_H = 600;
const SPEED = 190;
const VALID_COLORS = [
  "#ff5c70", "#36d8f5", "#5be39b",
  "#ffcf56", "#c59bff", "#ff9cdb"
];

const $ = id => document.getElementById(id);

const menu = $("menu");
const lobby = $("lobby");
const game = $("game");
const canvas = $("world");
const ctx = canvas.getContext("2d");

let auth;
let db;
let me = null;
let roomCode = null;
let roomData = null;
let roomRef = null;
let roomListener = null;
let moving = { up: false, down: false, left: false, right: false };
let lastSent = 0;
let lastFrame = 0;
let unsubscribe = null;
let busy = false;
let notice = "";
let noticeTimer = null;

const walls = [
  {x: 0, y: 0, w: 960, h: 25},
  {x: 0, y: 575, w: 960, h: 25},
  {x: 0, y: 0, w: 25, h: 600},
  {x: 935, y: 0, w: 25, h: 600},
  {x: 190, y: 25, w: 24, h: 155},
  {x: 190, y: 255, w: 24, h: 110},
  {x: 190, y: 445, w: 24, h: 130},
  {x: 390, y: 25, w: 24, h: 120},
  {x: 390, y: 225, w: 24, h: 155},
  {x: 390, y: 465, w: 24, h: 110},
  {x: 600, y: 25, w: 24, h: 155},
  {x: 600, y: 265, w: 24, h: 110},
  {x: 600, y: 455, w: 24, h: 120},
  {x: 770, y: 145, w: 165, h: 22},
  {x: 770, y: 330, w: 165, h: 22}
];

function showMessage(text, where = "message") {
  $(where).textContent = text;
}

function setStatus(text) {
  $("connection").textContent = text;
}

function showScreen(screen) {
  menu.classList.toggle("hidden", screen !== "menu");
  lobby.classList.toggle("hidden", screen !== "lobby");
  game.classList.toggle("hidden", screen !== "game");
}

function validConfig() {
  return firebaseConfig.apiKey !== "BURAYA_API_KEY" &&
    firebaseConfig.authDomain !== "BURAYA_AUTH_DOMAIN" &&
    firebaseConfig.databaseURL.startsWith("https://") &&
    firebaseConfig.projectId !== "BURAYA_PROJECT_ID" &&
    firebaseConfig.appId !== "BURAYA_APP_ID";
}

async function initialise() {
  if (!validConfig()) {
    setStatus("Firebase ayarı gerekli");
    showMessage("Önce game.js içindeki Firebase ayarlarını doldur.");
    $("createRoom").disabled = true;
    $("joinRoom").disabled = true;
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();

    await auth.signInAnonymously();
    me = auth.currentUser;

    setStatus("Bağlandı");
    $("createRoom").disabled = false;
    $("joinRoom").disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Bağlantı hatası");
    showMessage("Firebase bağlantısı kurulamadı. Ayarları ve interneti kontrol et.");
  }
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getPlayerDetails() {
  const name = $("playerName").value.trim().slice(0, 16);
  const color = $("playerColor").value;

  if (!name) {
    showMessage("Önce bir oyuncu adı yaz.");
    return null;
  }

  if (!VALID_COLORS.includes(color)) {
    showMessage("Geçersiz renk seçimi.");
    return null;
  }

  return { name, color };
}

function initialPosition() {
  return {
    x: 80 + Math.random() * 100,
    y: 90 + Math.random() * 100
  };
}

async function createRoom() {
  if (!me || busy) return;
  const details = getPlayerDetails();
  if (!details) return;

  busy = true;
  $("createRoom").disabled = true;

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const pos = initialPosition();

      const initialRoom = {
        host: me.uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        started: false,
        players: {
          [me.uid]: {
            uid: me.uid,
            name: details.name,
            color: details.color,
            x: pos.x,
            y: pos.y,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
          }
        }
      };

      const result = await db.ref("rooms/" + code)
        .transaction(current => current === null ? initialRoom : undefined);

      if (result.committed) {
        await enterRoom(code);
        return;
      }
    }

    showMessage("Oda oluşturulamadı. Yeniden dene.");
  } catch (error) {
    console.error(error);
    showMessage("Oda oluşturulamadı. Firebase kurallarını kontrol et.");
  } finally {
    busy = false;
    $("createRoom").disabled = false;
  }
}

async function joinRoom() {
  if (!me || busy) return;
  const details = getPlayerDetails();
  if (!details) return;

  const code = $("roomCode").value.trim().toUpperCase();

  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    showMessage("Geçerli bir 6 karakterli oda kodu gir.");
    return;
  }

  busy = true;
  $("joinRoom").disabled = true;

  try {
    const ref = db.ref("rooms/" + code);
    const pos = initialPosition();

    const result = await ref.transaction(room => {
      if (!room || !room.players) return;
      if (room.started) return;

      const players = room.players || {};
      if (players[me.uid]) return room;

      if (Object.keys(players).length >= MAX_PLAYERS) return;

      players[me.uid] = {
        uid: me.uid,
        name: details.name,
        color: details.color,
        x: pos.x,
        y: pos.y,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };

      room.players = players;
      return room;
    });

    if (!result.committed) {
      showMessage("Oda bulunamadı, dolu veya oyun başlamış.");
      return;
    }

    await enterRoom(code);
  } catch (error) {
    console.error(error);
    showMessage("Odaya katılınamadı. Firebase kurallarını kontrol et.");
  } finally {
    busy = false;
    $("joinRoom").disabled = false;
  }
}

async function enterRoom(code) {
  roomCode = code;
  roomRef = db.ref("rooms/" + code);

  $("displayCode").textContent = code;
  $("gameRoom").textContent = "ODA: " + code;

  // Bağlantı kesilirse bu oyuncuyu odadan temizle.
  await roomRef.child("players/" + me.uid).onDisconnect().remove();

  if (roomListener) {
    roomRef.off("value", roomListener);
  }

  roomListener = snapshot => {
    roomData = snapshot.val();

    if (!roomData || !roomData.players || !roomData.players[me.uid]) {
      cleanupLocal();
      showScreen("menu");
      setStatus("Odadan çıkarıldın");
      showMessage("Oda kapanmış veya bağlantın kesilmiş.");
      return;
    }

    renderLobby();

    if (roomData.started) {
      showScreen("game");
    } else {
      showScreen("lobby");
    }
  };

  roomRef.on("value", roomListener);
  setStatus("Odaya bağlandı");
}

function renderLobby() {
  if (!roomData || !roomData.players) return;

  const players = Object.values(roomData.players);
  $("playerCount").textContent =
    "Oyuncular: " + players.length + "/" + MAX_PLAYERS;

  $("gamePlayers").textContent =
    "OYUNCU: " + players.length + "/" + MAX_PLAYERS;

  const list = $("playerList");
  list.replaceChildren();

  players.forEach(player => {
    const row = document.createElement("div");
    row.className = "player-row";

    const dot = document.createElement("span");
    dot.className = "player-dot";
    dot.style.backgroundColor = player.color;

    const name = document.createElement("span");
    name.textContent = player.name || "Oyuncu";

    const tag = document.createElement("span");
    tag.className = "muted";
    tag.textContent = player.uid === roomData.host ? "Oda sahibi" : "Oyuncu";

    row.append(dot, name, tag);
    list.append(row);
  });

  const isHost = me && roomData.host === me.uid;
  $("startGame").disabled = !isHost || players.length < 1;
  $("startGame").textContent = isHost ? "Oyuna başla" : "Oda sahibi başlatır";
}

async function startGame() {
  if (!roomRef || !roomData || roomData.host !== me.uid) return;

  try {
    const result = await roomRef.transaction(room => {
      if (!room || room.host !== me.uid || room.started) return;
      if (!room.players || Object.keys(room.players).length < 1) return;
      room.started = true;
      return room;
    });

    if (!result.committed) {
      showMessage("Oyun başlatılamadı.", "lobbyMessage");
    }
  } catch (error) {
    console.error(error);
    showMessage("Başlatma hatası.", "lobbyMessage");
  }
}

function collides(x, y) {
  const radius = 14;

  if (x - radius < 25 || x + radius > WORLD_W - 25 ||
      y - radius < 25 || y + radius > WORLD_H - 25) {
    return true;
  }

  return walls.slice(4).some(w => {
    return x + radius > w.x &&
      x - radius < w.x + w.w &&
      y + radius > w.y &&
      y - radius < w.y + w.h;
  });
}

function movePlayer(dx, dy) {
  if (!roomData || !roomData.players || !me) return;

  const p = roomData.players[me.uid];
  if (!p) return;

  let x = p.x + dx;
  let y = p.y + dy;

  if (!collides(x, p.y)) p.x = x;
  if (!collides(p.x, y)) p.y = y;

  // Hareketi yerel olarak hemen göster.
  roomData.players[me.uid] = p;
}

async function sendPosition() {
  if (!roomRef || !me || !roomData || !roomData.players) return;

  const p = roomData.players[me.uid];
  if (!p) return;

  try {
    await roomRef.child("players/" + me.uid).update({
      x: p.x,
      y: p.y,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  } catch (error) {
    console.warn("Konum gönderilemedi:", error.message);
  }
}

function drawWorld() {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);

  ctx.fillStyle = "#0a1223";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Yıldızlar
  for (let i = 0; i < 65; i++) {
    const x = (i * 137 + 53) % WORLD_W;
    const y = (i * 83 + 19) % WORLD_H;
    ctx.fillStyle = i % 3 === 0 ? "#536b9c" : "#263a5d";
    ctx.fillRect(x, y, 2, 2);
  }

  // Odalar
  const rooms = [
    {x: 45, y: 50, w: 125, h: 120, name: "KOKPİT"},
    {x: 245, y: 50, w: 115, h: 100, name: "REAKTÖR"},
    {x: 440, y: 50, w: 125, h: 120, name: "LABORATUVAR"},
    {x: 650, y: 50, w: 245, h: 80, name: "DEPO"},
    {x: 45, y: 410, w: 125, h: 120, name: "GÜVENLİK"},
    {x: 245, y: 440, w: 115, h: 90, name: "ELEKTRİK"},
    {x: 440, y: 410, w: 125, h: 120, name: "MEDİKAL"},
    {x: 650, y: 410, w: 245, h: 120, name: "KANTİN"}
  ];

  rooms.forEach(r => {
    ctx.fillStyle = "#172641";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#3b557e";
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#8298bf";
    ctx.font = "12px system-ui";
    ctx.fillText(r.name, r.x + 9, r.y + 18);
  });

  // Duvarlar
  ctx.fillStyle = "#53688c";
  walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));

  if (!roomData || !roomData.players) return;

  Object.values(roomData.players).forEach(p => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

    const x = p.x;
    const y = p.y;

    // Karakter gövdesi
    ctx.fillStyle = p.color || "#36d8f5";
    ctx.beginPath();
    ctx.roundRect(x - 13, y - 15, 26, 29, 8);
    ctx.fill();

    // Vizör
    ctx.fillStyle = "#b8f3ff";
    ctx.beginPath();
    ctx.roundRect(x - 8, y - 10, 17, 9, 4);
    ctx.fill();

    // İsim etiketi
    ctx.textAlign = "center";
    ctx.font = "bold 12px system-ui";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#07101d";
    ctx.strokeText(p.name || "Oyuncu", x, y - 23);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(p.name || "Oyuncu", x, y - 23);
    ctx.textAlign = "start";
  });
}

function frame(time) {
  const dt = Math.min((time - (lastFrame || time)) / 1000, 0.05);
  lastFrame = time;

  if (!game.classList.contains("hidden") &&
      roomData && roomData.started && me) {
    let dx = 0;
    let dy = 0;

    if (moving.left) dx--;
    if (moving.right) dx++;
    if (moving.up) dy--;
    if (moving.down) dy++;

    if (dx || dy) {
      const length = Math.hypot(dx, dy) || 1;
      movePlayer(dx / length * SPEED * dt, dy / length * SPEED * dt);

      if (time - lastSent > 100) {
        lastSent = time;
        sendPosition();
      }
    }
  }

  drawWorld();
  requestAnimationFrame(frame);
}

function setDirection(direction, value) {
  moving[direction] = value;
  const button = document.querySelector('[data-dir="' + direction + '"]');
  if (button) button.classList.toggle("pressed", value);
}

function stopMoving() {
  Object.keys(moving).forEach(key => setDirection(key, false));
}

function cleanupLocal() {
  stopMoving();

  if (roomRef && roomListener) {
    roomRef.off("value", roomListener);
  }

  roomRef = null;
  roomListener = null;
  roomData = null;
  roomCode = null;
}

async function leaveRoom() {
  const ref = roomRef;
  const code = roomCode;
  const wasHost = roomData && me && roomData.host === me.uid;

  cleanupLocal();
  showScreen("menu");

  if (!ref || !me) return;

  try {
    await ref.child("players/" + me.uid).onDisconnect().cancel();
    await ref.child("players/" + me.uid).remove();

    if (wasHost) {
      // Oda sahibi ayrılırsa kalan oyuncular arasından yeni sahip seç.
      const roomSnapshot = await ref.get();
      const room = roomSnapshot.val();

      if (room && room.players && Object.keys(room.players).length) {
        const nextHost = Object.keys(room.players)[0];
        await ref.child("host").set(nextHost);
      } else if (room) {
        await ref.remove();
      }
    }
  } catch (error) {
    console.warn("Odadan ayrılırken hata:", error.message);
  }

  setStatus("Odadan ayrıldın");
}

// Klavye kontrolleri
const keyMap = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right"
};

window.addEventListener("keydown", event => {
  const direction = keyMap[event.key];
  if (direction && !game.classList.contains("hidden")) {
    event.preventDefault();
    setDirection(direction, true);
  }
});

window.addEventListener("keyup", event => {
  const direction = keyMap[event.key];
  if (direction) setDirection(direction, false);
});

window.addEventListener("blur", stopMoving);

document.querySelectorAll("[data-dir]").forEach(button => {
  const direction = button.dataset.dir;

  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setDirection(direction, true);
  });

  button.addEventListener("pointerup", () => setDirection(direction, false));
  button.addEventListener("pointercancel", () => setDirection(direction, false));
  button.addEventListener("lostpointercapture", () => setDirection(direction, false));
});

$("createRoom").addEventListener("click", createRoom);
$("joinRoom").addEventListener("click", joinRoom);
$("startGame").addEventListener("click", startGame);
$("leaveRoom").addEventListener("click", leaveRoom);
$("backToLobby").addEventListener("click", () => {
  if (roomData && !roomData.started) showScreen("lobby");
  else showScreen("lobby");
});

$("copyCode").addEventListener("click", async () => {
  if (!roomCode) return;
  try {
    await navigator.clipboard.writeText(roomCode);
    showMessage("Oda kodu kopyalandı.", "lobbyMessage");
  } catch {
    showMessage("Oda kodun: " + roomCode, "lobbyMessage");
  }
});

$("roomCode").addEventListener("input", event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
});

initialise();
requestAnimationFrame(frame);
