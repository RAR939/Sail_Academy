// Измените эту переменную, если захотите переименовать надпись в шапке.
const BRAND_TITLE = "Sail Academy";
document.documentElement.style.setProperty("--brand-title", JSON.stringify(BRAND_TITLE));
document.querySelector("#brand-title").textContent = BRAND_TITLE;
document.title = `${BRAND_TITLE} — Вход в клуб`;

const form = document.querySelector("#auth-form");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const heading = document.querySelector("#heading");
const subtitle = document.querySelector("#subtitle");
const password = document.querySelector("#password");
const submitButton = document.querySelector("#submit-button");
const message = document.querySelector("#message");
const togglePassword = document.querySelector("#toggle-password");
const signedIn = document.querySelector("#signed-in");
const signedInText = document.querySelector("#signed-in-text");
const logoutButton = document.querySelector("#logout-button");

let mode = "login";

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}
function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  loginTab.setAttribute("aria-selected", String(!registering));
  registerTab.setAttribute("aria-selected", String(registering));
  heading.textContent = registering ? "Вступай в экипаж" : "Добро пожаловать на борт";
  subtitle.textContent = registering
    ? "Создай аккаунт и начни обучение."
    : "Войди в клуб, чтобы продолжить обучение.";
  submitButton.innerHTML = registering
    ? '<span aria-hidden="true">✦</span> Создать аккаунт'
    : '<span aria-hidden="true">↪</span> Войти в игру';
  password.autocomplete = registering ? "new-password" : "current-password";
  password.minLength = registering ? 10 : 10;
  showMessage("");
}
loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));

togglePassword.addEventListener("click", () => {
  const reveal = password.type === "password";
  password.type = reveal ? "text" : "password";
  togglePassword.textContent = reveal ? "⊘" : "◉";
  togglePassword.setAttribute("aria-label", reveal ? "Скрыть пароль" : "Показать пароль");
  togglePassword.title = reveal ? "Скрыть пароль" : "Показать пароль";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitButton.disabled = true;
  showMessage("Проверяем данные…");
  const payload = {
    username: document.querySelector("#username").value.trim(),
    password: password.value
  };
  try {
    const response = await fetch(mode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      showMessage(result.message || "Не удалось выполнить запрос.", "error");
      return;
    }
    password.value = "";
    showMessage(result.message, "success");
    signedIn.hidden = false;
    signedInText.textContent = `Ты вошёл как ${payload.username}. Следующий этап — выбор персонажа.`;
    submitButton.innerHTML = '<span aria-hidden="true">✓</span> Ты в клубе!';
    submitButton.disabled = true;
    loginTab.disabled = true;
    registerTab.disabled = true;
  } catch {
    showMessage("Не удалось связаться с сервером. Проверь, запущен ли FastAPI.", "error");
  } finally {
    if (!message.classList.contains("success")) submitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("logout failed");
    signedIn.hidden = true;
    loginTab.disabled = false;
    registerTab.disabled = false;
    submitButton.disabled = false;
    setMode("login");
    showMessage("Ты вышел из аккаунта.", "success");
    submitButton.innerHTML = '<span aria-hidden="true">↪</span> Войти в игру';
  } catch {
    showMessage("Не удалось выйти. Попробуй ещё раз.", "error");
  }
});

(async function checkExistingSession() {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) return;
    const result = await response.json();
    if (result.ok) {
      signedIn.hidden = false;
      signedInText.textContent = `Ты уже вошёл как ${result.username}. Следующий этап — выбор персонажа.`;
      submitButton.innerHTML = '<span aria-hidden="true">✓</span> Ты в клубе!';
      submitButton.disabled = true;
      loginTab.disabled = true;
      registerTab.disabled = true;
    }
  } catch { /* Сервер покажет ошибку при отправке формы. */ }
})();
