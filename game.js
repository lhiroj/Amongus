
(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    alert("Canvas desteklenmiyor. Güncel bir tarayıcı deneyin.");
    return;
  }

  const $ = id => document.getElementById(id);

  const ui = {
    menu: $("menu"),
    play: $("playButton"),
    how: $("howButton"),
    instructions: $("instructions"),
    joystick: $("joystick"),
    stick: $("stick"),
    mapButton: $("mapButton"),
    mapOverlay: $("mapOverlay"),
    mapPreview: $("mapPreview"),
    taskButton: $("taskButton"),
    taskOverlay: $("taskOverlay"),
    taskDescription: $("taskDescription"),
    interact: $("interactButton"),
    closeTask: $("closeTask"),
    hint: $("hint"),
    toast: $("toast")
  };

  const WORLD = { w: 1900, h: 1400 };
  const PLAYER_RADIUS = 17;
  const SPEED = 225;
  const INTERACT_DISTANCE = 65;

  const rooms = [
    { name: "KOMUTA", x: 660, y: 100, w: 530, h: 280 },
    { name: "ELEKTRİK", x: 120, y: 460, w: 350, h: 260 },
    { name: "MOTOR", x: 120, y: 900, w: 390, h: 300 },
    { name: "MEDİKAL", x: 700, y: 490, w: 350, h: 260 },
    { name: "DEPO", x: 690, y: 920, w: 400, h: 280 },
    { name: "LABORATUVAR", x: 1370, y: 450, w: 390, h: 280 },
    { name: "GÜVENLİK", x: 1370, y: 900, w: 390, h: 300 },
    { name: "HABERLEŞME", x: 1350, y: 100, w: 410, h: 260 }
  ];

  // Her dikdörtgen geçilmez bir duvardır.
  // Kapı açıklıkları duvarların ayrı parçalara bölünmesiyle oluşturulur.
  const walls = [];

  function wall(x, y, w, h) {
    walls.push({ x, y, w, h });
  }

  function roomWalls(r, doors) {
    const t = 14;
    const d = doors || {};

    // Üst ve alt duvarlar: kapı açıklığı varsa iki parçaya ayrılır.
    for (const side of ["top", "bottom"]) {
      const y = side === "top" ? r.y : r.y + r.h - t;
      const gap = d[side];

      if (!gap) {
        wall(r.x, y, r.w, t);
      } else {
        const start = r.x + gap - 48;
        const end = r.x + gap + 48;
        wall(r.x, y, start - r.x, t);
        wall(end, y, r.x + r.w - end, t);
      }
    }

    for (const side of ["left", "right"]) {
      const x = side === "left" ? r.x : r.x + r.w - t;
      const gap = d[side];

      if (!gap) {
        wall(x, r.y, t, r.h);
      } else {
        const start = r.y + gap - 48;
        const end = r.y + gap + 48;
        wall(x, r.y, t, start - r.y);
        wall(x, end, t, r.y + r.h - end);
      }
    }
  }

  roomWalls(rooms[0], { bottom: 270 });
  roomWalls(rooms[1], { right: 130 });
  roomWalls(rooms[2], { right: 150 });
  roomWalls(rooms[3], { top: 180, bottom: 170 });
  roomWalls(rooms[4], { top: 190 });
  roomWalls(rooms[5], { left: 150 });
  roomWalls(rooms[6], { left: 150 });
  roomWalls(rooms[7], { bottom: 140 });

  // Koridor bağlantıları.
  // Harita sınırları ayrıca çarpışma hesabında korunur.
  const stations = [
    { name: "Kablo Bağlama", x: 280, y: 560, color: "#ffcf68", done: false },
    { name: "Enerji Paneli", x: 830, y: 220, color: "#62edff", done: false },
    { name: "Kart Okutma", x: 850, y: 590, color: "#e69bff", done: false },
    { name: "Motor Kalibrasyonu", x: 290, y: 1020, color: "#ff9a76", done: false },
    { name: "Veri Yükleme", x: 850, y: 1020, color: "#81ffb0", done: false },
    { name: "Numara Sıralama", x: 1510, y: 550, color: "#91a9ff", done: false }
  ];

  const player = {
    x: 920,
    y: 400,
    vx: 0,
    vy: 0,
    color: "#e84d59",
    name: "OYUNCU",
    angle: 0
  };

  const camera = { x: 0, y: 0 };
  const input = { x: 0, y: 0 };
  const state = {
    started: false,
    paused: true,
    mapOpen: false,
    taskOpen: false,
    taskTarget: null,
    toastUntil: 0,
    lastTime: 0,
    elapsed: 0
  };

  let viewWidth = innerWidth;
  let viewHeight = innerHeight;
  let dpr = 1;
  let joystickPointer = null;

  function resize() {
    viewWidth = innerWidth;
    viewHeight = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 1.75);

    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);

    canvas.style.width = viewWidth + "px";
    canvas.style.height = viewHeight + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateCamera();
  }

  addEventListener("resize", resize);
  resize();

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updateCamera() {
    camera.x = clamp(
      player.x - viewWidth / 2,
      0,
      Math.max(0, WORLD.w - viewWidth)
    );

    camera.y = clamp(
      player.y - viewHeight / 2,
      0,
      Math.max(0, WORLD.h - viewHeight)
    );
  }

  function overlapsCircleRect(x, y, radius, r) {
    const px = clamp(x, r.x, r.x + r.w);
    const py = clamp(y, r.y, r.y + r.h);
    const dx = x - px;
    const dy = y - py;
    return dx * dx + dy * dy < radius * radius;
  }

  function collides(x, y) {
    if (
      x - PLAYER_RADIUS < 0 ||
      y - PLAYER_RADIUS < 0 ||
      x + PLAYER_RADIUS > WORLD.w ||
      y + PLAYER_RADIUS > WORLD.h
    ) return true;

    return walls.some(r => overlapsCircleRect(x, y, PLAYER_RADIUS, r));
  }

  function movePlayer(dx, dy) {
    const nx = player.x + dx;
    const ny = player.y + dy;

    // X ve Y ayrı çözülür; böylece duvar kenarlarından kayılabilir.
    if (!collides(nx, player.y)) player.x = nx;
    if (!collides(player.x, ny)) player.y = ny;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function nearestStation() {
    let best = null;
    let bestDistance = INTERACT_DISTANCE;

    for (const station of stations) {
      if (station.done) continue;

      const d = distance(player, station);
      if (d < bestDistance) {
        best = station;
        bestDistance = d;
      }
    }

    return best;
  }

  function showToast(message, duration = 2000) {
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    state.toastUntil = performance.now() + duration;
  }

  function updateInteraction() {
    const station = nearestStation();

    ui.interact.disabled = !state.started ||
      state.paused || !station;

    ui.hint.textContent = station
      ? "Yakında görev var: " + station.name
      : "Uzay gemisini keşfet!";
  }

  function openTask() {
    const station = nearestStation();

    if (!station) {
      showToast("Önce bir görev istasyonuna yaklaş!");
      return;
    }

    state.taskTarget = station;
    state.taskOpen = true;
    state.paused = true;

    ui.taskDescription.textContent =
      station.name + " istasyonunda görev başlatıldı. " +
      "Bu ilk prototipte görev etkileşimi temel düzeydedir.";

    ui.taskOverlay.classList.remove("hidden");
  }

  function closeTask() {
    state.taskOpen = false;
    state.paused = false;
    ui.taskOverlay.classList.add("hidden");
    state.taskTarget = null;
  }

  function drawBackground() {
    ctx.fillStyle = "#080e19";
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Yıldızlar.
    for (let i = 0; i < 150; i++) {
      const x = (i * 197 + 31) % WORLD.w;
      const y = (i * 313 + 83) % WORLD.h;
      ctx.globalAlpha = 0.2 + (i % 5) * 0.12;
      ctx.fillStyle = "#a8d9ff";
      ctx.fillRect(x, y, i % 7 === 0 ? 3 : 1.5, i % 7 === 0 ? 3 : 1.5);
    }

    ctx.globalAlpha = 1;

    // Geminin dış gövdesi.
    ctx.fillStyle = "#111d2b";
    ctx.strokeStyle = "#31495e";
    ctx.lineWidth = 22;
    ctx.fillRect(35, 35, WORLD.w - 70, WORLD.h - 70);
    ctx.strokeRect(35, 35, WORLD.w - 70, WORLD.h - 70);

    // Ana koridorlar.
    ctx.fillStyle = "#1b2a3b";
    ctx.fillRect(470, 390, 900, 65);
    ctx.fillRect(480, 730, 880, 65);
    ctx.fillRect(500, 390, 60, 340);
    ctx.fillRect(1180, 380, 65, 360);
    ctx.fillRect(1080, 1040, 300, 60);
    ctx.fillRect(1060, 120, 60, 280);

    // Odalar.
    for (const room of rooms) {
      ctx.fillStyle = "#172638";
      ctx.fillRect(room.x, room.y, room.w, room.h);

      ctx.strokeStyle = "#48647c";
      ctx.lineWidth = 4;
      ctx.strokeRect(room.x, room.y, room.w, room.h);

      ctx.fillStyle = "#91abc2";
      ctx.font = "bold 15px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(room.name, room.x + room.w / 2, room.y + 34);

      ctx.fillStyle = "#20364a";
      for (let x = room.x + 22; x < room.x + room.w - 20; x += 55) {
        ctx.fillRect(x, room.y + 50, 40, 5);
      }
    }

    // Görev istasyonları.
    for (const s of stations) {
      ctx.save();
      ctx.translate(s.x, s.y);

      ctx.fillStyle = s.done ? "#2b7958" : s.color;
      ctx.globalAlpha = 0.17;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#101c2b";
      ctx.strokeStyle = s.done ? "#6dffb5" : s.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-19, -17, 38, 34, 7);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = s.done ? "#6dffb5" : s.color;
      ctx.fillRect(-9, -7, 18, 4);
      ctx.fillRect(-9, 1, 12, 4);

      ctx.restore();
    }

    // Çarpışma duvarları.
    for (const r of walls) {
      ctx.fillStyle = "#61788c";
      ctx.fillRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = "#a4b6c5";
      if (r.w > r.h) {
        ctx.fillRect(r.x, r.y, r.w, 3);
      } else {
        ctx.fillRect(r.x, r.y, 3, r.h);
      }
    }

    ctx.restore();
  }

  function drawCharacter() {
    const t = state.elapsed;
    const moving = Math.hypot(input.x, input.y) > 0.1;
    const bob = moving ? Math.sin(t * 13) * 2 : 0;

    ctx.save();
    ctx.translate(player.x - camera.x, player.y - camera.y);
    ctx.rotate(player.angle);

    // Gölge.
    ctx.fillStyle = "#0008";
    ctx.beginPath();
    ctx.ellipse(2, 13, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sırt çantası.
    ctx.fillStyle = "#a52f43";
    ctx.beginPath();
    ctx.roundRect(-20, -8 + bob, 11, 24, 5);
    ctx.fill();

    // Gövde.
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.roundRect(-16, -19 + bob, 31, 39, 12);
    ctx.fill();

    // Vizör.
    ctx.fillStyle = "#a9efff";
    ctx.beginPath();
    ctx.roundRect(-2, -13 + bob, 22, 14, 7);
    ctx.fill();

    ctx.fillStyle = "#e9fcff";
    ctx.fillRect(3, -10 + bob, 9, 3);

    ctx.restore();

    ctx.save();
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#07101c";
    ctx.strokeText(player.name, player.x - camera.x, player.y - camera.y - 31);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(player.name, player.x - camera.x, player.y - camera.y - 31);
    ctx.restore();
  }

  function drawMinimap() {
    const w = 180;
    const h = 130;
    const x = viewWidth - w - 16;
    const y = 76;

    ctx.save();
    ctx.fillStyle = "#07111deF";
    ctx.strokeStyle = "#3c627b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    const sx = (w - 20) / WORLD.w;
    const sy = (h - 20) / WORLD.h;

    for (const room of rooms) {
      ctx.fillStyle = "#304c62";
      ctx.fillRect(
        x + 10 + room.x * sx,
        y + 10 + room.y * sy,
        room.w * sx,
        room.h * sy
      );
    }

    ctx.fillStyle = "#ff6572";
    ctx.beginPath();
    ctx.arc(
      x + 10 + player.x * sx,
      y + 10 + player.y * sy,
      4, 0, Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
  }

  function renderMapPreview() {
    const w = 500;
    const h = 390;

    ui.mapPreview.innerHTML = "";
    const mini = document.createElement("canvas");
    mini.width = w;
    mini.height = h;
    mini.style.width = "100%";
    mini.style.height = "100%";
    ui.mapPreview.appendChild(mini);

    const c = mini.getContext("2d");
    c.fillStyle = "#0b1422";
    c.fillRect(0, 0, w, h);

    const sx = (w - 30) / WORLD.w;
    const sy = (h - 30) / WORLD.h;

    for (const r of rooms) {
      c.fillStyle = "#243b51";
      c.fillRect(15 + r.x * sx, 15 + r.y * sy, r.w * sx, r.h * sy);
      c.strokeStyle = "#6689a3";
      c.strokeRect(15 + r.x * sx, 15 + r.y * sy, r.w * sx, r.h * sy);
      c.fillStyle = "#ffffff";
      c.font = "10px system-ui";
      c.fillText(r.name, 15 + r.x * sx + 3, 15 + r.y * sy + 13);
    }

    for (const s of stations) {
      c.fillStyle = s.done ? "#55f0a2" : "#ffd46d";
      c.beginPath();
      c.arc(15 + s.x * sx, 15 + s.y * sy, 5, 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = "#ff596a";
    c.beginPath();
    c.arc(15 + player.x * sx, 15 + player.y * sy, 6, 0, Math.PI * 2);
    c.fill();
  }

  function update(dt) {
    if (!state.started || state.paused) return;

    state.elapsed += dt;

    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);

    if (len > 1) {
      ix /= len;
      iy /= len;
    }

    player.vx = ix * SPEED;
    player.vy = iy * SPEED;

    movePlayer(player.vx * dt, player.vy * dt);

    if (len > 0.08) {
      player.angle = Math.atan2(iy, ix);
    }

    updateCamera();
    updateInteraction();
  }

  function render() {
    drawBackground();
    drawCharacter();

    if (state.started) drawMinimap();

    if (performance.now() > state.toastUntil) {
      ui.toast.classList.add("hidden");
    }

    requestAnimationFrame(render);
  }

  function frame(now) {
    const dt = Math.min((now - state.lastTime) / 1000 || 0, 0.033);
    state.lastTime = now;
    update(dt);
    requestAnimationFrame(frame);
  }

  function startGame() {
    state.started = true;
    state.paused = false;
    state.elapsed = 0;

    player.x = 920;
    player.y = 400;
    player.vx = 0;
    player.vy = 0;
    input.x = 0;
    input.y = 0;

    stations.forEach(s => s.done = false);

    ui.menu.classList.add("hidden");
    updateCamera();
    showToast("Görev istasyonlarını keşfet!", 2500);
  }

  // Çoklu dokunma: joystick yalnızca kendisini başlatan parmağı izler.
  function updateStick(event) {
    const rect = ui.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    let dx = event.clientX - cx;
    let dy = event.clientY - cy;

    const max = rect.width * 0.32;
    const length = Math.hypot(dx, dy);

    if (length > max) {
      dx = dx / length * max;
      dy = dy / length * max;
    }

    input.x = dx / max;
    input.y = dy / max;

    ui.stick.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function releaseStick(event) {
    if (event.pointerId !== joystickPointer) return;

    joystickPointer = null;
    input.x = 0;
    input.y = 0;
    ui.stick.style.transform = "translate(0, 0)";
  }

  ui.joystick.addEventListener("pointerdown", event => {
    if (joystickPointer !== null) return;

    event.preventDefault();
    joystickPointer = event.pointerId;
    ui.joystick.setPointerCapture(event.pointerId);
    updateStick(event);
  });

  ui.joystick.addEventListener("pointermove", event => {
    if (event.pointerId !== joystickPointer) return;
    event.preventDefault();
    updateStick(event);
  });

  ui.joystick.addEventListener("pointerup", releaseStick);
  ui.joystick.addEventListener("pointercancel", releaseStick);
  ui.joystick.addEventListener("lostpointercapture", releaseStick);

  ui.play.addEventListener("click", startGame);

  ui.how.addEventListener("click", () => {
    ui.instructions.classList.toggle("hidden");
  });

  ui.mapButton.addEventListener("click", () => {
    if (!state.started || state.taskOpen) return;

    state.mapOpen = !state.mapOpen;
    state.paused = state.mapOpen;

    ui.mapOverlay.classList.toggle("hidden", !state.mapOpen);

    if (state.mapOpen) renderMapPreview();
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => {
      state.mapOpen = false;
      state.paused = false;
      ui.mapOverlay.classList.add("hidden");
    });
  });

  ui.interact.addEventListener("click", openTask);

  ui.taskButton.addEventListener("click", () => {
    ui.taskDescription.textContent =
      "Sarı simgeler görev istasyonlarını gösterir. " +
      "İlk prototipte görevler henüz tamamlanamaz; " +
      "etkileşimli mini görevler sonraki geliştirme aşamasında eklenecek.";

    state.paused = true;
    state.taskOpen = true;
    ui.taskOverlay.classList.remove("hidden");
  });

  ui.closeTask.addEventListener("click", closeTask);

  // Tarayıcı sekmesi gizlenince kontrolün takılı kalmasını önle.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      input.x = 0;
      input.y = 0;
      ui.stick.style.transform = "translate(0, 0)";
      if (state.started) state.paused = true;
    }
  });

  document.addEventListener("contextmenu", event => event.preventDefault());

  requestAnimationFrame(now => {
    state.lastTime = now;
    requestAnimationFrame(frame);
  });

  render();
})();
