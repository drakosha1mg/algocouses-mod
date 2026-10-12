const $ = (id) => document.getElementById(id);

function show(student, forceEdit) {
  const has = student && student.firstName && student.lastName;
  const editing = forceEdit || !has;
  $("form").classList.toggle("hidden", !editing);
  $("view").classList.toggle("hidden", editing);
  if (has) {
    $("greeting").textContent = `Привет, ${student.firstName} ${student.lastName}!`;
    $("lastName").value = student.lastName;
    $("firstName").value = student.firstName;
  }
}

chrome.storage.local.get("student", ({ student }) => {
  show(student, false);
  $("edit").addEventListener("click", () => show(student, true));
});

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const student = {
    lastName: $("lastName").value.trim().replace(/\s+/g, " "),
    firstName: $("firstName").value.trim().replace(/\s+/g, " "),
  };
  if (!student.lastName || !student.firstName) return;
  // Сохранённые результаты относятся к прежнему ФИО — сбрасываем.
  chrome.storage.local.get(null, (all) => {
    const stale = Object.keys(all).filter((k) => k.startsWith("course_"));
    chrome.storage.local.remove(stale, () => {
      chrome.storage.local.set({ student }, () => show(student, false));
    });
  });
});
