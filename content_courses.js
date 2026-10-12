(() => {
  const BADGE_CLASS = "acg-badge";
  const LINK_RE = /конспект|запис|контест|условия|результаты|дедлайн/i;
  const DATE_RE =
    /\d{1,2}\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)|\d{4}\s*г/i;
  const HEADING_SEL =
    "h1,h2,h3,h4,h5,h6,[class*='title' i],[class*='name' i],[class*='header' i],strong,b";

  const norm = (s) =>
    (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

  const courseId = () => {
    const m = location.pathname.match(/\/courses\/([^/]+)/);
    return m ? m[1] : null;
  };

  // Заголовок темы внутри контейнера: первый «заголовочный» элемент, не являющийся датой.
  function topicHeading(container) {
    for (const el of container.querySelectorAll(HEADING_SEL)) {
      if (el.classList.contains(BADGE_CLASS) || el.closest("." + BADGE_CLASS)) continue;
      if (el.querySelector(HEADING_SEL)) continue; // берём самый вложенный
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (!text || text.length > 120 || DATE_RE.test(text) || LINK_RE.test(text)) continue;
      return { el, text };
    }
    return null;
  }

  // Карточки: для каждой ссылки (Конспект/Запись/Контест) поднимаемся до предка с заголовком темы.
  function findCards() {
    const cards = new Map(); // card -> title
    for (const a of document.querySelectorAll("a")) {
      if (!LINK_RE.test(a.textContent)) continue;
      let node = a.parentElement;
      while (node && node !== document.body) {
        const h = topicHeading(node);
        if (h) {
          if (!cards.has(node)) cards.set(node, h.text);
          break;
        }
        node = node.parentElement;
      }
    }
    // Если одна карточка вложена в другую, оставляем самую внутреннюю.
    for (const outer of Array.from(cards.keys())) {
      for (const inner of cards.keys()) {
        if (inner !== outer && outer.contains(inner)) {
          cards.delete(outer);
          break;
        }
      }
    }
    return cards;
  }

  function findGrade(grades, title) {
    const t = norm(title);
    for (const [topic, grade] of Object.entries(grades)) {
      if (norm(topic) === t) return grade;
    }
    for (const [topic, grade] of Object.entries(grades)) {
      const n = norm(topic);
      if (n && (t.includes(n) || n.includes(t))) return grade;
    }
    return null;
  }

  function setBadge(card, text, cls) {
    let badge = card.querySelector(":scope > ." + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      card.appendChild(badge);
    }
    const className = `${BADGE_CLASS} ${cls}`;
    if (badge.className !== className) badge.className = className;
    if (badge.textContent !== text) badge.textContent = text;
  }

  function removeBadge(card) {
    const badge = card.querySelector(":scope > ." + BADGE_CLASS);
    if (badge) badge.remove();
  }

  function gradeClass(g) {
    const n = parseFloat(g);
    if (n >= 8) return "acg-good";
    if (n >= 5) return "acg-mid";
    return "acg-bad";
  }

  // Плавающая панель со всеми оценками: работает независимо от вёрстки карточек.
  function renderPanel(student, info) {
    let panel = document.getElementById("acg-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "acg-panel";
      document.body.appendChild(panel);
    }
    let html = '<div class="acg-panel-title">Оценки</div>';
    if (!student || !student.firstName || !student.lastName) {
      html += '<div class="acg-panel-row">Введите ФИО в расширении</div>';
    } else if (!info) {
      html += '<div class="acg-panel-row">Откройте «Табличку» курса, чтобы загрузить результаты</div>';
    } else if (!info.current_student_found) {
      html += '<div class="acg-panel-row">Вас нет в таблице</div>';
    } else {
      for (const [topic, g] of Object.entries(info.grades || {})) {
        const el = document.createElement("span");
        el.textContent = topic;
        html += `<div class="acg-panel-row"><span>${el.innerHTML}</span><b class="${gradeClass(g)}">${g}</b></div>`;
      }
    }
    if (panel.innerHTML !== html) panel.innerHTML = html;
  }

  let busy = false;
  function render() {
    if (busy) return;
    const id = courseId();
    if (!id) return;
    busy = true;
    chrome.storage.local.get(["student", "course_" + id], (data) => {
      try {
        const student = data.student;
        const info = data["course_" + id];
        const hasName = student && student.firstName && student.lastName;
        renderPanel(student, info);
        const cards = findCards();

        for (const [card, title] of cards) {
          if (!hasName) {
            setBadge(card, "Введите ФИО в расширении", "acg-none");
          } else if (!info) {
            removeBadge(card); // результаты ещё не загружены
          } else if (!info.current_student_found) {
            setBadge(card, "Нету", "acg-none");
          } else {
            const grade = findGrade(info.grades || {}, title);
            if (grade === null) removeBadge(card);
            else setBadge(card, `Оценка: ${grade} / 10`, gradeClass(grade));
          }
        }
      } finally {
        busy = false;
      }
    });
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  };

  render();
  new MutationObserver((muts) => {
    // игнорируем изменения, вызванные самими бэджами
    const own = muts.every((m) => m.target.id === "acg-panel" || (m.target.closest && m.target.closest("#acg-panel"))) ||
      muts.every((m) =>
      [...m.addedNodes, ...m.removedNodes].every(
        (n) => n.nodeType === 1 && n.classList.contains(BADGE_CLASS)
      ) && (m.addedNodes.length || m.removedNodes.length) ||
      (m.type === "characterData" && m.target.parentElement &&
        m.target.parentElement.classList.contains(BADGE_CLASS))
    );
    if (!own) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.storage.onChanged.addListener((_, area) => {
    if (area === "local") schedule();
  });
})();
