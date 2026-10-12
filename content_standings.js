(() => {
  const SUM_RE = /^[Σ∑]$|^sum$|^сумма$/i;

  const norm = (s) =>
    (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

  const courseId = () => {
    const m = location.pathname.match(/\/courses\/([^/]+)/);
    return m ? m[1] : null;
  };

  // Раскрывает заголовок таблицы в сетку с учётом colspan/rowspan.
  function buildHeaderGrid(headRows) {
    const grid = [];
    headRows.forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of tr.cells) {
        while (grid[r][c]) c++;
        const cs = Math.max(1, parseInt(cell.colSpan, 10) || 1);
        const rs = Math.max(1, parseInt(cell.rowSpan, 10) || 1);
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (r + dr >= headRows.length) continue;
            grid[r + dr] = grid[r + dr] || [];
            grid[r + dr][c + dc] = cell;
          }
        }
        c += cs;
      }
    });
    return grid;
  }

  // Возвращает [{topic, sumCol, maxTasks}] для таблицы.
  function parseHeader(table) {
    const rows = Array.from(table.rows);
    const headRows = [];
    for (const tr of rows) {
      const isHead =
        (tr.parentElement && tr.parentElement.tagName === "THEAD") ||
        !tr.querySelector("td");
      if (!isHead) break;
      headRows.push(tr);
    }
    if (headRows.length === 0) return [];

    const grid = buildHeaderGrid(headRows);
    const leaf = grid[grid.length - 1] || [];
    const topics = [];

    for (let c = 0; c < leaf.length; c++) {
      const leafCell = leaf[c];
      if (!leafCell || !SUM_RE.test(norm(leafCell.textContent))) continue;

      // Ближайшая сверху ячейка с текстом, отличная от самой «Σ» (не rowspan).
      let topCell = null;
      for (let r = grid.length - 2; r >= 0; r--) {
        const cell = grid[r] && grid[r][c];
        if (cell && cell !== leafCell && norm(cell.textContent)) {
          topCell = cell;
          break;
        }
      }
      if (!topCell) continue; // общий итог («Σ» на всю высоту шапки)

      const topic = topCell.textContent.replace(/\s+/g, " ").trim();
      let maxTasks = 0;
      for (let cc = 0; cc < leaf.length; cc++) {
        const lc = leaf[cc];
        if (!lc || SUM_RE.test(norm(lc.textContent))) continue;
        // колонка принадлежит этой теме, если над ней та же верхняя ячейка
        for (let r = grid.length - 2; r >= 0; r--) {
          if (grid[r] && grid[r][cc] === topCell) {
            maxTasks++;
            break;
          }
        }
      }
      if (maxTasks > 0) topics.push({ topic, sumCol: c, maxTasks });
    }
    return { topics, headCount: headRows.length };
  }

  function nameMatches(cellText, student) {
    const have = norm(cellText).split(" ").filter(Boolean);
    const want = norm(`${student.lastName} ${student.firstName}`).split(" ").filter(Boolean);
    if (!want.length || have.length < want.length) return false;
    if (!want.every((w) => have.includes(w))) return false;
    // допускаем отчество/лишние слова, но не чужие длинные строки
    return have.length <= want.length + 2;
  }

  function findStudentRow(table, headCount, student) {
    const rows = Array.from(table.rows).slice(headCount);
    for (const tr of rows) {
      for (const cell of tr.cells) {
        if (cell.querySelector("table")) continue;
        if (nameMatches(cell.textContent, student)) return tr;
      }
    }
    return null;
  }

  function toNumber(text) {
    const m = (text || "").replace(",", ".").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function compute(student) {
    let best = null;
    for (const table of document.querySelectorAll("table")) {
      const parsed = parseHeader(table);
      if (!parsed || !parsed.topics || parsed.topics.length === 0) continue;
      const row = findStudentRow(table, parsed.headCount, student);
      const grades = {};
      if (row) {
        // в строках данных colspan обычно нет; на случай их наличия считаем смещение
        const cells = [];
        for (const cell of row.cells) {
          const cs = Math.max(1, parseInt(cell.colSpan, 10) || 1);
          for (let i = 0; i < cs; i++) cells.push(cell);
        }
        for (const t of parsed.topics) {
          const cell = cells[t.sumCol];
          if (!cell) continue;
          const solved = Math.min(toNumber(cell.textContent), t.maxTasks);
          grades[t.topic] = ((solved / t.maxTasks) * 10).toFixed(2);
        }
      }
      const result = { found: !!row, grades };
      if (row) return result;
      best = best || result;
    }
    return best;
  }

  let running = false;
  function run() {
    if (running) return;
    const id = courseId();
    if (!id) return;
    running = true;
    chrome.storage.local.get(["student", "course_" + id], (data) => {
      try {
        const student = data.student;
        if (!student || !student.firstName || !student.lastName) return;
        const result = compute(student);
        if (!result) return; // таблица ещё не отрисована

        const key = "course_" + id;
        const prev = data[key];
        const sameStudent =
          prev && prev.student === `${student.lastName} ${student.firstName}`;
        const prevFound = sameStudent && prev.current_student_found;

        let value;
        if (result.found) {
          const merged = Object.assign({}, prevFound ? prev.grades : {}, result.grades);
          value = { current_student_found: true, grades: merged };
        } else if (prevFound) {
          return; // на другой странице результатов студента нет — не затираем найденное
        } else {
          value = { current_student_found: false, grades: {} };
        }
        value.student = `${student.lastName} ${student.firstName}`;

        if (JSON.stringify(prev) !== JSON.stringify(value)) {
          chrome.storage.local.set({ [key]: value });
        }
      } finally {
        running = false;
      }
    });
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  };

  // Образец ответа API сохраняем для отладки: по нему можно написать разбор JSON.
  async function dumpApi() {
    const holder = document.querySelector("[data-api-url]");
    let url = holder && holder.getAttribute("data-api-url");
    if (!url) {
      const m = location.pathname.match(/\/courses\/([^/]+)\/standings\/([^/]+)/);
      if (m) url = `/api/standings/${m[1]}/${m[2]}`;
    }
    if (!url) return;
    try {
      const resp = await fetch(url, { credentials: "include" });
      const text = await resp.text();
      chrome.storage.local.set({
        debug_api: { url, status: resp.status, sample: text.slice(0, 4000) },
      });
      console.log("[acg] API", url, resp.status, text.slice(0, 1500));
    } catch (e) {
      chrome.storage.local.set({ debug_api: { url, error: String(e) } });
    }
  }

  dumpApi();
  run();
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.student) schedule();
  });
})();
