(() => {
  // ===== Canvas + High DPI Resize =====
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width  = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); // draw in CSS pixels
  }
  window.addEventListener("resize", resizeCanvas, {passive:true});
  resizeCanvas();

  // ===== Helpers =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  // ===== Game State =====
  const STATE = { MENU:"menu", PLAY:"play", PAUSE:"pause", QUIZ:"quiz", OVER:"over" };
  let state = STATE.MENU;

  // ===== Virtual input (teclado + touch) =====
  const input = { left:false, right:false, fire:false };
  const keyboard = { left:false, right:false, fire:false };

  canvas.tabIndex = 0;

  function focusGame(){
    canvas.focus({ preventScroll:true });
  }

  function setKeyboardState(key, isDown){
    if (key === "ArrowLeft") keyboard.left = isDown;
    if (key === "ArrowRight") keyboard.right = isDown;
    if (key === " ") keyboard.fire = isDown;

    // When the player uses the keyboard, stop following the last pointer target.
    if (isDown && (key === "ArrowLeft" || key === "ArrowRight")) {
      player.targetX = null;
    }
  }

  // Keyboard support (opcional si abres en tablet con teclado)
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) {
      e.preventDefault();
    }

    focusGame();
    setKeyboardState(e.key, true);

    if (e.key.toLowerCase() === "p" && !e.repeat) togglePause();
  }, { passive:false });

  window.addEventListener("keyup", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) {
      e.preventDefault();
    }
    setKeyboardState(e.key, false);
  }, { passive:false });

  window.addEventListener("blur", () => {
    keyboard.left = false;
    keyboard.right = false;
    keyboard.fire = false;
  });

  // Touch buttons
  const btnLeft  = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");
  const btnFire  = document.getElementById("btnFire");
  const btnPause = document.getElementById("btnPause");

  function bindHoldButton(el, onDown, onUp){
    const down = (e)=>{ e.preventDefault(); onDown(); };
    const up   = (e)=>{ e.preventDefault(); onUp(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }
  bindHoldButton(btnLeft,  ()=> input.left=true,  ()=> input.left=false);
  bindHoldButton(btnRight, ()=> input.right=true, ()=> input.right=false);
  bindHoldButton(btnFire,  ()=> input.fire=true,  ()=> input.fire=false);
  btnPause.addEventListener("pointerdown", (e)=>{ e.preventDefault(); togglePause(); });

  function togglePause(){
    if (state === STATE.PLAY) state = STATE.PAUSE;
    else if (state === STATE.PAUSE) state = STATE.PLAY;
  }

  // Drag to move on canvas
  let dragActive = false;
  let dragPointerId = null;

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    focusGame();
    canvas.setPointerCapture?.(e.pointerId);

    // Map to CSS pixels (because we draw in CSS pixels after setTransform)
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state === STATE.MENU) { startGame(); return; }
    if (state === STATE.OVER) { startGame(); return; }

    if (state === STATE.QUIZ && quizActive) {
      // click options
      for (const opt of quizButtons) {
        if (x >= opt.x && x <= opt.x + opt.w && y >= opt.y && y <= opt.y + opt.h) {
          answerQuiz(opt.index);
          return;
        }
      }
    }

    // Start drag
    dragActive = true;
    dragPointerId = e.pointerId;
    dragMoveTo(x, y);

    // Tap also fires (nice on mobile)
    input.fire = true;
    setTimeout(()=>{ input.fire = false; }, 80);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragActive || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragMoveTo(x, y);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerId === dragPointerId) {
      dragActive = false;
      dragPointerId = null;
    }
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId === dragPointerId) {
      dragActive = false;
      dragPointerId = null;
    }
  });

  // Double-tap to fullscreen
  let lastTap = 0;
  canvas.addEventListener("pointerup", (e) => {
    const t = Date.now();
    if (t - lastTap < 320) {
      requestFullscreen();
    }
    lastTap = t;
  });

  async function requestFullscreen(){
    const el = document.documentElement;
    try{
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    }catch(_){}
    setTimeout(resizeCanvas, 200);
  }

  function dragMoveTo(x, y){
    // Snap player's x toward finger; y ignored (keep at bottom)
    player.targetX = x;
  }

  // ===== Entities =====
  const player = {
    x: 0, y: 0,
    targetX: null,
    r: 18,
    vx: 0,
    speed: 440, // px/s
    cooldown: 0,
    baseFireRate: 180, // ms
    shield: 0,
    multishot: 0,
    rapid: 0,
    hp: 3
  };

  const bullets = [];
  const enemies = [];
  const particles = [];
  const powerDrops = [];

  // ===== Progression =====
  let score = 0;
  let level = 1;
  let spawnTimer = 0;
  let spawnEvery = 900;
  let lastTime = now();
  let elapsedInPlay = 0;

  // ===== Quiz =====
  const QUIZ_INTERVAL_MS = 30000;
  let nextQuizAt = QUIZ_INTERVAL_MS;

  const questionBank = [
    { q:"¿Cuál célula presenta antígeno por MHC II de forma profesional?", a:["Neutrófilo","Célula dendrítica","Eritrocito"], correct:1 },
    { q:"¿Qué inmunoglobulina predomina en mucosas?", a:["IgA","IgD","IgE"], correct:0 },
    { q:"El complemento (C3b) favorece principalmente:", a:["Opsonización","Clase switching","Tolerancia central"], correct:0 },
    { q:"La hipersensibilidad tipo I está mediada por:", a:["IgE + mastocitos","IgG + complemento","Linfocitos T CD8+"], correct:0 },
    { q:"En respuesta antiviral, la citocina clave temprana suele ser:", a:["IL-4","IFN tipo I","TGF-β"], correct:1 },
    { q:"¿Qué receptor reconoce PAMPs bacterianos como LPS?", a:["TLR4","TCR","CD28"], correct:0 },
    { q:"La memoria inmunológica adaptativa depende sobre todo de:", a:["Células NK","Linfocitos B y T de memoria","Macrófagos residentes"], correct:1 }
  ];

  let quizActive = false;
  let quiz = null;
  let quizButtons = [];

  function pickQuiz(){
    const item = questionBank[Math.floor(Math.random()*questionBank.length)];
    return { q:item.q, a:[...item.a], correct:item.correct };
  }

  // ===== Power-ups =====
  const POWERS = {
    MULTI: { name:"Multishot",  duration: 12000 },
    RAPID: { name:"Rapid Fire", duration: 12000 },
    SHIELD:{ name:"Shield",     duration: 10000 }
  };

  function grantRandomPower(){
    const choices = [POWERS.MULTI, POWERS.RAPID, POWERS.SHIELD];
    const p = choices[Math.floor(Math.random()*choices.length)];
    if (p === POWERS.MULTI) player.multishot = p.duration;
    if (p === POWERS.RAPID) player.rapid = p.duration;
    if (p === POWERS.SHIELD) player.shield = p.duration;
    toast(`${p.name} activado`);
  }

  // ===== UI Toast =====
  let toastMsg = "";
  let toastUntil = 0;
  function toast(msg, ms=1400){
    toastMsg = msg;
    toastUntil = now() + ms;
  }

  // ===== Game Dimensions in CSS pixels =====
  function W(){ return canvas.getBoundingClientRect().width; }
  function H(){ return canvas.getBoundingClientRect().height; }

  // ===== Spawning =====
  function spawnEnemy(){
    const isVirus = Math.random() < 0.62;
    const baseSpeed = 70 + level * 10;
    enemies.push({
      type: isVirus ? "virus" : "bacteria",
      x: rand(40, W()-40),
      y: -30,
      r: isVirus ? rand(16, 22) : rand(18, 26),
      vx: isVirus ? rand(-40, 40) : rand(-15, 15),
      vy: isVirus ? baseSpeed + rand(0, 35) : baseSpeed*0.85 + rand(0, 25),
      hp: isVirus ? 1 : 2,
      wobble: isVirus ? rand(0, Math.PI*2) : 0
    });
  }

  function maybeDropPower(x,y){
    if (Math.random() < 0.12) {
      const kind = Math.random() < 0.34 ? "MULTI" : (Math.random() < 0.5 ? "RAPID" : "SHIELD");
      powerDrops.push({ x, y, r: 12, vy: 140, kind });
    }
  }

  // ===== Shooting =====
  function fire(){
    const fireRate = player.rapid > 0 ? 90 : player.baseFireRate;
    if (player.cooldown > 0) return;
    player.cooldown = fireRate;

    const y = player.y - player.r - 6;
    const speed = 620;

    if (player.multishot > 0) {
      bullets.push({ x: player.x, y, vx: 0,    vy: -speed,      r: 4 });
      bullets.push({ x: player.x, y, vx: -140, vy: -speed*0.95, r: 4 });
      bullets.push({ x: player.x, y, vx:  140, vy: -speed*0.95, r: 4 });
    } else {
      bullets.push({ x: player.x, y, vx: 0, vy: -speed, r: 4 });
    }
  }

  // ===== Collisions =====
  function hitCircle(ax,ay,ar, bx,by,br){
    const dx = ax - bx, dy = ay - by;
    return (dx*dx + dy*dy) <= (ar+br)*(ar+br);
  }

  // ===== Particles =====
  function boom(x,y, n=14){
    for (let i=0;i<n;i++){
      particles.push({ x, y, vx: rand(-220,220), vy: rand(-220,220), life: rand(300,650) });
    }
  }

  // ===== Leveling =====
  function updateLevel(){
    const newLevel = 1 + Math.floor(score / 18);
    if (newLevel !== level) { level = newLevel; toast(`Nivel ${level}`); }
    spawnEvery = clamp(900 - (level-1)*70, 360, 900);
  }

  // ===== Game Flow =====
  function reset(){
    bullets.length = 0; enemies.length = 0; particles.length = 0; powerDrops.length = 0;
    score = 0; level = 1; spawnTimer = 0; spawnEvery = 900;

    player.x = W()*0.5;
    player.y = H() - 52;
    player.targetX = null;
    player.vx = 0;
    player.cooldown = 0;
    player.hp = 3;
    player.shield = 0;
    player.multishot = 0;
    player.rapid = 0;

    elapsedInPlay = 0;
    nextQuizAt = QUIZ_INTERVAL_MS;
    quizActive = false; quiz = null; quizButtons = [];
    toastMsg = ""; toastUntil = 0;
  }

  function startGame(){
    reset();
    state = STATE.PLAY;
    lastTime = now();
    focusGame();
  }

  function gameOver(){ state = STATE.OVER; toast("Game Over"); }

  // ===== Quiz =====
  function openQuiz(){ quizActive = true; quiz = pickQuiz(); quizButtons = []; state = STATE.QUIZ; }

  function answerQuiz(index){
    if (!quizActive) return;
    const ok = index === quiz.correct;
    quizActive = false;

    if (ok){ toast("Correcto ✅ Power-up!"); grantRandomPower(); }
    else { toast("Incorrecto ❌ Sin power-up"); }

    nextQuizAt += QUIZ_INTERVAL_MS;
    state = STATE.PLAY;
  }

  // ===== Drawing primitives =====
  function roundRect(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function wrapText(text, x, y, maxWidth, lineHeight){
    const words = String(text).split(" ");
    let line = "";
    let yy = y;
    ctx.textAlign = "center";
    for (let n=0; n<words.length; n++){
      const testLine = line + words[n] + " ";
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, yy);
        line = words[n] + " ";
        yy += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, yy);
  }

  // ===== Drawing =====
  function drawAmbient(t){
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i=0;i<28;i++){
      const xx = (Math.sin(t/1400 + i*9.1) * 0.5 + 0.5) * W();
      const yy = (Math.cos(t/1800 + i*7.7) * 0.5 + 0.5) * H();
      ctx.beginPath();
      ctx.arc(xx, yy, 1.6, 0, Math.PI*2);
      ctx.fillStyle = "rgba(233,242,255,.9)";
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer(){
    ctx.save();
    ctx.translate(player.x, player.y);

    if (player.shield > 0) {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, player.r+10, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(140,220,255,.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, player.r, 0, Math.PI*2);
    ctx.fillStyle = "rgba(80, 255, 180, .95)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(-5, 2, 7, 0, Math.PI*2);
    ctx.fillStyle = "rgba(10,20,30,.35)";
    ctx.fill();

    ctx.strokeStyle = "rgba(80, 255, 180, .35)";
    ctx.lineWidth = 3;
    for (let i=0;i<4;i++){
      const ang = (i/4)*Math.PI*2 + 0.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang)*player.r*0.7, Math.sin(ang)*player.r*0.7);
      ctx.lineTo(Math.cos(ang)*(player.r+9), Math.sin(ang)*(player.r+9));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEnemy(e){
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.type === "virus") {
      ctx.beginPath();
      ctx.arc(0,0,e.r,0,Math.PI*2);
      ctx.fillStyle = "rgba(255,90,120,.92)";
      ctx.fill();

      ctx.strokeStyle = "rgba(255,90,120,.55)";
      ctx.lineWidth = 2;
      for (let i=0;i<10;i++){
        const ang = (i/10)*Math.PI*2 + e.wobble;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang)*e.r*0.9, Math.sin(ang)*e.r*0.9);
        ctx.lineTo(Math.cos(ang)*(e.r+10), Math.sin(ang)*(e.r+10));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0,0,e.r*0.35,0,Math.PI*2);
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.fill();
    } else {
      const w = e.r*2.2, h = e.r*1.25;
      roundRect(-w/2, -h/2, w, h, h/2);
      ctx.fillStyle = "rgba(255,190,70,.92)";
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 2;
      for (let i=-2;i<=2;i++){
        ctx.beginPath();
        ctx.moveTo(i*8, -h/2+4);
        ctx.lineTo(i*8,  h/2-4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0,0,4,0,Math.PI*2);
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBullet(b){
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fillStyle = "rgba(140,220,255,.95)";
    ctx.fill();
  }

  function drawPower(p){
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.arc(0,0,p.r,0,Math.PI*2);
    ctx.fillStyle = "rgba(190,160,255,.92)";
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.kind[0], 0, 1);
    ctx.restore();
  }

  function drawParticles(dt){
    for (let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * (dt/1000);
      p.y += p.vy * (dt/1000);
      p.vx *= 0.98; p.vy *= 0.98;

      const a = clamp(p.life/650, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(p.x, p.y, 2, 2);

      if (p.life <= 0) particles.splice(i,1);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD(){
    ctx.save();
    ctx.fillStyle = "rgba(233,242,255,.92)";
    ctx.font = "600 16px system-ui";
    ctx.fillText(`Score: ${score}`, 18, 26);
    ctx.fillText(`Nivel: ${level}`, 18, 48);
    ctx.fillText(`HP: ${"♥".repeat(player.hp)}`, 18, 70);

    const px = W() - 18;
    ctx.textAlign = "right";
    const parts = [];
    if (player.multishot > 0) parts.push(`Multishot ${Math.ceil(player.multishot/1000)}s`);
    if (player.rapid > 0) parts.push(`Rapid ${Math.ceil(player.rapid/1000)}s`);
    if (player.shield > 0) parts.push(`Shield ${Math.ceil(player.shield/1000)}s`);
    if (parts.length) ctx.fillText(parts.join(" · "), px, 26);
    else { ctx.globalAlpha = 0.6; ctx.fillText("Sin power-ups", px, 26); ctx.globalAlpha = 1; }

    if (now() < toastUntil) {
      ctx.globalAlpha = 0.95;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,.35)";
      roundRect(W()/2 - 160, 86, 320, 34, 14);
      ctx.fill();
      ctx.fillStyle = "rgba(233,242,255,.95)";
      ctx.font = "600 14px system-ui";
      ctx.fillText(toastMsg, W()/2, 108);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawMenu(){
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0,0,W(),H());

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(233,242,255,.96)";
    ctx.font = "800 44px system-ui";
    ctx.fillText("IMMUNE DEFENSE", W()/2, H()*0.38);

    ctx.font = "600 18px system-ui";
    ctx.globalAlpha = 0.9;
    ctx.fillText("Arcade educativo — elimina patógenos y responde quizzes", W()/2, H()*0.38 + 38);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundRect(W()/2 - 170, H()*0.38 + 70, 340, 54, 16);
    ctx.fill();
    ctx.fillStyle = "rgba(233,242,255,.95)";
    ctx.font = "700 18px system-ui";
    ctx.fillText("Toca para iniciar", W()/2, H()*0.38 + 104);

    ctx.globalAlpha = 0.75;
    ctx.font = "600 14px system-ui";
    ctx.fillText("Arrastra en el canvas para moverte. Botón DISPARAR para atacar.", W()/2, H()*0.38 + 150);
    ctx.restore();
  }

  function drawPause(){
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0,0,W(),H());
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(233,242,255,.96)";
    ctx.font = "800 40px system-ui";
    ctx.fillText("PAUSA", W()/2, H()/2);
    ctx.font = "600 16px system-ui";
    ctx.globalAlpha = 0.85;
    ctx.fillText("Toca ⏸ para continuar", W()/2, H()/2 + 34);
    ctx.restore();
  }

  function drawOver(){
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0,0,W(),H());
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(233,242,255,.96)";
    ctx.font = "900 46px system-ui";
    ctx.fillText("GAME OVER", W()/2, H()*0.42);

    ctx.font = "700 18px system-ui";
    ctx.globalAlpha = 0.9;
    ctx.fillText(`Score final: ${score} · Nivel: ${level}`, W()/2, H()*0.42 + 40);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundRect(W()/2 - 170, H()*0.42 + 70, 340, 54, 16);
    ctx.fill();
    ctx.fillStyle = "rgba(233,242,255,.95)";
    ctx.font = "700 18px system-ui";
    ctx.fillText("Toca para reiniciar", W()/2, H()*0.42 + 104);
    ctx.restore();
  }

  function drawQuiz(){
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0,0,W(),H());

    const cw = Math.min(680, W()-40);
    const ch = 330;
    const cx = W()/2 - cw/2;
    const cy = H()/2 - ch/2;

    ctx.fillStyle = "rgba(255,255,255,.06)";
    roundRect(cx, cy, cw, ch, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(233,242,255,.15)";
    ctx.lineWidth = 1;
    roundRect(cx, cy, cw, ch, 18);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(233,242,255,.96)";
    ctx.font = "800 24px system-ui";
    ctx.fillText("Quiz de Inmunología", W()/2, cy + 42);

    if (!quiz) { ctx.restore(); return; }

    ctx.font = "650 17px system-ui";
    ctx.globalAlpha = 0.92;
    wrapText(quiz.q, W()/2, cy + 86, cw - 60, 24);

    quizButtons = [];
    const bw = cw - 80;
    const bh = 46, gap = 14;
    const bx = W()/2 - bw/2;
    let by = cy + 156;

    for (let i=0;i<3;i++){
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,.25)";
      roundRect(bx, by, bw, bh, 14);
      ctx.fill();
      ctx.strokeStyle = "rgba(233,242,255,.18)";
      ctx.stroke();

      ctx.fillStyle = "rgba(233,242,255,.95)";
      ctx.font = "650 16px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${i+1}. ${quiz.a[i]}`, bx + 16, by + bh/2);

      quizButtons.push({ x: bx, y: by, w: bw, h: bh, index: i });
      by += bh + gap;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.75;
    ctx.font = "600 13px system-ui";
    ctx.fillText("Toca una opción para continuar. (Acierto = power-up)", W()/2, cy + ch - 18);

    ctx.restore();
  }

  // ===== Update =====
  function update(dt){
    elapsedInPlay += dt;
    if (elapsedInPlay >= nextQuizAt) { openQuiz(); return; }

    // powers decay
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.shield = Math.max(0, player.shield - dt);
    player.multishot = Math.max(0, player.multishot - dt);
    player.rapid = Math.max(0, player.rapid - dt);

    const moveLeft = input.left || keyboard.left;
    const moveRight = input.right || keyboard.right;
    const wantsFire = input.fire || keyboard.fire;

    // move player: either with drag target or buttons/keyboard
    if ((keyboard.left || keyboard.right) && player.targetX != null) {
      player.targetX = null;
    }

    if (player.targetX != null) {
      const dx = player.targetX - player.x;
      player.vx = clamp(dx * 8, -player.speed, player.speed);
    } else {
      let dir = 0;
      if (moveLeft) dir -= 1;
      if (moveRight) dir += 1;
      player.vx = dir * player.speed;
    }
    player.x += player.vx * (dt/1000);
    player.y = H() - 52; // keep at bottom even on resize
    player.x = clamp(player.x, player.r + 12, W() - player.r - 12);

    // fire
    if (wantsFire) fire();

    // spawn enemies
    spawnTimer += dt;
    while (spawnTimer >= spawnEvery) {
      spawnTimer -= spawnEvery;
      spawnEnemy();
    }

    // bullets
    for (let i=bullets.length-1;i>=0;i--){
      const b = bullets[i];
      b.x += b.vx * (dt/1000);
      b.y += b.vy * (dt/1000);
      if (b.y < -30 || b.x < -40 || b.x > W()+40) bullets.splice(i,1);
    }

    // enemies
    for (let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      if (e.type === "virus") { e.wobble += 0.02; e.vx += Math.sin(e.wobble) * 2.2; }
      e.x += e.vx * (dt/1000);
      e.y += e.vy * (dt/1000);
      if (e.x < 24 || e.x > W()-24) e.vx *= -1;

      if (e.y > H() + 30) { enemies.splice(i,1); takeDamage(); continue; }

      if (hitCircle(e.x,e.y,e.r, player.x,player.y, player.r+4)) {
        enemies.splice(i,1);
        boom(e.x,e.y, 18);
        if (player.shield <= 0) takeDamage();
        continue;
      }
    }

    // bullet-enemy collisions
    for (let ei=enemies.length-1; ei>=0; ei--){
      const e = enemies[ei];
      for (let bi=bullets.length-1; bi>=0; bi--){
        const b = bullets[bi];
        if (hitCircle(e.x,e.y,e.r, b.x,b.y, b.r+2)) {
          bullets.splice(bi,1);
          e.hp -= 1;
          boom(b.x,b.y, 8);
          if (e.hp <= 0) {
            enemies.splice(ei,1);
            score += (e.type === "virus" ? 1 : 2);
            boom(e.x,e.y, 18);
            maybeDropPower(e.x, e.y);
            updateLevel();
          }
          break;
        }
      }
    }

    // power drops
    for (let i=powerDrops.length-1;i>=0;i--){
      const p = powerDrops[i];
      p.y += p.vy * (dt/1000);
      if (p.y > H() + 40) powerDrops.splice(i,1);
      else if (hitCircle(p.x,p.y,p.r, player.x,player.y, player.r+4)) {
        powerDrops.splice(i,1);
        applyPower(p.kind);
      }
    }

    // reset one-frame fire from keyboard if held? (leave as is)
  }

  function applyPower(kind){
    if (kind === "MULTI") player.multishot = POWERS.MULTI.duration;
    if (kind === "RAPID") player.rapid = POWERS.RAPID.duration;
    if (kind === "SHIELD") player.shield = POWERS.SHIELD.duration;
    toast(`${POWERS[kind].name} obtenido`);
  }

  function takeDamage(){
    if (player.shield > 0) return;
    player.hp -= 1;
    toast("Daño recibido");
    if (player.hp <= 0) gameOver();
  }

  function drawScene(dt){
    for (const e of enemies) drawEnemy(e);
    for (const b of bullets) drawBullet(b);
    for (const p of powerDrops) drawPower(p);
    drawPlayer();
    drawParticles(dt);
    drawHUD();
  }

  // ===== Main Loop =====
  function tick(){
    const t = now();
    let dt = t - lastTime;
    lastTime = t;
    dt = clamp(dt, 0, 40);

    // Ensure canvas matches layout (in case of fullscreen/orientation)
    // (cheap check)
    if (Math.abs(canvas.width - canvas.getBoundingClientRect().width * (window.devicePixelRatio||1)) > 50) {
      resizeCanvas();
    }

    // clear in CSS pixels (thanks to transform)
    ctx.clearRect(0,0,W(),H());
    drawAmbient(t);

    if (state === STATE.MENU) { drawMenu(); requestAnimationFrame(tick); return; }
    if (state === STATE.OVER) { drawOver(); requestAnimationFrame(tick); return; }
    if (state === STATE.PAUSE) { drawScene(0); drawPause(); requestAnimationFrame(tick); return; }
    if (state === STATE.QUIZ) { drawScene(0); drawQuiz(); requestAnimationFrame(tick); return; }

    // PLAY
    update(dt);
    drawScene(dt);

    // reset "tap fire" one-shot if needed
    // (keep input.fire true while button held; drag tap uses short timeout already)
    requestAnimationFrame(tick);
  }

  // Init positions once layout exists
  reset();
  tick();

})();





