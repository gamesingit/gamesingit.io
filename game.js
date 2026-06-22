(() => {
  const DIFFICULTY = {
    easy:   { cols: 9,  rows: 9,  mines: 10 },
    medium: { cols: 16, rows: 16, mines: 40 },
    hard:   { cols: 30, rows: 16, mines: 99 },
  };

  const boardEl    = document.getElementById('board');
  const mineCountEl= document.getElementById('mine-count');
  const timerEl    = document.getElementById('timer');
  const faceEl     = document.getElementById('face');
  const restartBtn = document.getElementById('restart');
  const difficultySel = document.getElementById('difficulty');
  const cursorOnlyChk = document.getElementById('mouse-cursor-only');
  const keySchemeSel  = document.getElementById('key-scheme');
  const keyHelpEl     = document.getElementById('key-help');

  // 각 스킴은 [열기, chord, 깃발] 순서의 키. 모두 소문자/심볼 그대로.
  const KEY_SCHEMES = {
    zxc:      { reveal: 'z', chord: 'x', flag: 'c', label: 'Z=열기, X=주변 열기, C=깃발' },
    brackets: { reveal: '[', chord: ']', flag: '\\', label: '[=열기, ]=주변 열기, \\=깃발' },
    asd:      { reveal: 'a', chord: 's', flag: 'd', label: 'A=열기, S=주변 열기, D=깃발' },
    jkl:      { reveal: 'j', chord: 'k', flag: 'l', label: 'J=열기, K=주변 열기, L=깃발' },
  };

  function currentScheme() {
    return KEY_SCHEMES[keySchemeSel.value] || KEY_SCHEMES.zxc;
  }

  function updateKeyHelp() {
    keyHelpEl.textContent = currentScheme().label;
  }

  let cols, rows, totalMines;
  let cells = [];          // 2D array: { mine, revealed, flagged, n, el }
  let cursor = { x: 0, y: 0 };
  let firstClick = true;
  let gameOver = false;
  let won = false;
  let flagsPlaced = 0;
  let timer = 0;
  let timerInterval = null;

  // 마우스 양쪽 클릭(코드) 추적
  let mouseButtons = 0;

  function init(difficulty) {
    const cfg = DIFFICULTY[difficulty];
    cols = cfg.cols;
    rows = cfg.rows;
    totalMines = cfg.mines;
    firstClick = true;
    gameOver = false;
    won = false;
    flagsPlaced = 0;
    timer = 0;
    cursor = { x: 0, y: 0 };

    clearInterval(timerInterval);
    timerInterval = null;
    timerEl.textContent = '0';
    faceEl.textContent = '🙂';
    updateMineCount();

    buildBoard();
    renderCursor();
    boardEl.focus();
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 28px)`;
    cells = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.x = x;
        el.dataset.y = y;
        boardEl.appendChild(el);
        row.push({ mine: false, revealed: false, flagged: false, n: 0, el });
      }
      cells.push(row);
    }
  }

  function placeMines(safeX, safeY) {
    // 첫 클릭 위치와 그 주변 8칸은 지뢰 배치 금지 (편의)
    const forbidden = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = safeX + dx, ny = safeY + dy;
        if (inBounds(nx, ny)) forbidden.add(ny * cols + nx);
      }
    }
    let placed = 0;
    while (placed < totalMines) {
      const idx = Math.floor(Math.random() * cols * rows);
      if (forbidden.has(idx)) continue;
      const x = idx % cols, y = Math.floor(idx / cols);
      if (cells[y][x].mine) continue;
      cells[y][x].mine = true;
      placed++;
    }
    // 주변 지뢰 개수 계산
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (cells[y][x].mine) continue;
        cells[y][x].n = countAround(x, y, c => c.mine);
      }
    }
  }

  function inBounds(x, y) {
    return x >= 0 && x < cols && y >= 0 && y < rows;
  }

  function forEachNeighbor(x, y, fn) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny)) fn(cells[ny][nx], nx, ny);
      }
    }
  }

  function countAround(x, y, pred) {
    let count = 0;
    forEachNeighbor(x, y, c => { if (pred(c)) count++; });
    return count;
  }

  function reveal(x, y) {
    if (gameOver) return;
    const c = cells[y][x];
    if (c.revealed || c.flagged) return;

    if (firstClick) {
      placeMines(x, y);
      firstClick = false;
      startTimer();
    }

    if (c.mine) {
      c.revealed = true;
      c.el.classList.add('revealed', 'exploded');
      c.el.textContent = '💣';
      endGame(false);
      return;
    }

    floodFill(x, y);
    checkWin();
  }

  function floodFill(x, y) {
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const c = cells[cy][cx];
      if (c.revealed || c.flagged) continue;
      c.revealed = true;
      c.el.classList.add('revealed');
      if (c.n > 0) {
        c.el.textContent = c.n;
        c.el.dataset.n = c.n;
      } else {
        forEachNeighbor(cx, cy, (_, nx, ny) => stack.push([nx, ny]));
      }
    }
  }

  function toggleFlag(x, y) {
    if (gameOver) return;
    const c = cells[y][x];
    if (c.revealed) return;
    c.flagged = !c.flagged;
    c.el.classList.toggle('flag', c.flagged);
    c.el.textContent = c.flagged ? '🚩' : '';
    flagsPlaced += c.flagged ? 1 : -1;
    updateMineCount();
  }

  function chord(x, y) {
    // 숫자 칸에서 주변 깃발 수가 숫자와 같으면 나머지 칸을 모두 연다
    if (gameOver) return;
    const c = cells[y][x];
    if (!c.revealed || c.n === 0) return;
    const flagged = countAround(x, y, n => n.flagged);
    if (flagged !== c.n) return;
    forEachNeighbor(x, y, (n, nx, ny) => {
      if (!n.revealed && !n.flagged) reveal(nx, ny);
    });
  }

  function updateMineCount() {
    mineCountEl.textContent = totalMines - flagsPlaced;
  }

  function startTimer() {
    timerInterval = setInterval(() => {
      timer++;
      timerEl.textContent = timer;
    }, 1000);
  }

  function checkWin() {
    let unrevealed = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = cells[y][x];
        if (!c.revealed && !c.mine) unrevealed++;
      }
    }
    if (unrevealed === 0) endGame(true);
  }

  function endGame(isWin) {
    gameOver = true;
    won = isWin;
    clearInterval(timerInterval);
    timerInterval = null;
    faceEl.textContent = isWin ? '😎' : '😵';

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = cells[y][x];
        if (c.mine && !c.revealed) {
          if (isWin) {
            c.el.classList.add('flag');
            c.el.textContent = '🚩';
          } else if (!c.flagged) {
            c.el.classList.add('revealed', 'mine');
            c.el.textContent = '💣';
          }
        } else if (!c.mine && c.flagged) {
          c.el.textContent = '❌';
        }
      }
    }
  }

  // ----- 커서 (키보드 모드) -----
  function renderCursor() {
    document.querySelectorAll('.cell.cursor').forEach(el => el.classList.remove('cursor'));
    const c = cells[cursor.y]?.[cursor.x];
    if (c) c.el.classList.add('cursor');
  }

  function moveCursor(dx, dy) {
    cursor.x = Math.max(0, Math.min(cols - 1, cursor.x + dx));
    cursor.y = Math.max(0, Math.min(rows - 1, cursor.y + dy));
    renderCursor();
  }

  // ----- 이벤트 -----

  // 마우스
  boardEl.addEventListener('mousedown', (e) => {
    const target = e.target.closest('.cell');
    if (!target) return;
    mouseButtons = e.buttons; // bitmask: 1=left, 2=right, 4=middle
    const x = +target.dataset.x;
    const y = +target.dataset.y;
    cursor = { x, y };
    renderCursor();

    // "마우스는 위치만" 모드: 커서만 이동, 어떤 액션도 하지 않음
    if (cursorOnlyChk.checked) {
      e.preventDefault();
      return;
    }

    // 좌+우 동시 (또는 가운데 버튼) → chord
    if ((e.buttons & 3) === 3 || e.button === 1) {
      e.preventDefault();
      chord(x, y);
    }
  });

  boardEl.addEventListener('mouseup', (e) => {
    const target = e.target.closest('.cell');
    if (!target) return;
    const x = +target.dataset.x;
    const y = +target.dataset.y;

    // mouseup 시점에 이전에 양쪽이 눌려 있었으면 chord 처리
    const wasBoth = (mouseButtons & 3) === 3;
    mouseButtons = e.buttons;

    if (cursorOnlyChk.checked) return;

    if (wasBoth) {
      // 이미 mousedown에서 chord 처리함
      return;
    }
    if (e.button === 0) {
      reveal(x, y);
    } else if (e.button === 2) {
      toggleFlag(x, y);
    }
  });

  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // 키보드
  boardEl.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const scheme = currentScheme();
    const actionKeys = [scheme.reveal, scheme.chord, scheme.flag];

    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key) || actionKeys.includes(key)) {
      e.preventDefault();
    }

    switch (key) {
      case 'arrowup':    moveCursor(0, -1); return;
      case 'arrowdown':  moveCursor(0,  1); return;
      case 'arrowleft':  moveCursor(-1, 0); return;
      case 'arrowright': moveCursor( 1, 0); return;
      case ' ':
      case 'enter':
        if (gameOver) init(difficultySel.value);
        return;
    }

    if (key === scheme.reveal) reveal(cursor.x, cursor.y);
    else if (key === scheme.chord)  chord(cursor.x, cursor.y);
    else if (key === scheme.flag)   toggleFlag(cursor.x, cursor.y);
  });

  // 페이스 클릭 = 새 게임
  faceEl.addEventListener('click', () => init(difficultySel.value));
  restartBtn.addEventListener('click', () => init(difficultySel.value));
  difficultySel.addEventListener('change', () => init(difficultySel.value));
  keySchemeSel.addEventListener('change', updateKeyHelp);

  // 시작
  updateKeyHelp();
  init(difficultySel.value);
})();
