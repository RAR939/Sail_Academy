
import "../styles/auth.css";

export type AuthMode = "login" | "register";

export interface NetworkLoginValues {
  serverUrl: string;
  username: string;
  password: string;
  mode: AuthMode;
}

export class NetworkLoginOverlay {
  private readonly root: HTMLDivElement;
  private mode: AuthMode = "login";
  private readonly stopGameKeyboard = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

  constructor(
    private readonly onSubmit: (
      values: NetworkLoginValues
    ) => Promise<void>
  ) {
    this.root = document.createElement("div");
    this.root.className = "network-auth-root";

    this.root.innerHTML = `
      <main class="scene">
        <div class="scene-shade"></div>

        <header class="masthead">
          <h1 class="brand">Sail Academy</h1>
          <p class="brand-subtitle">СТУДЕНЧЕСКАЯ ПАРУСНАЯ АКАДЕМИЯ</p>
        </header>

        <section class="auth-card">
          <div class="eyebrow">
            <span></span>
            ДОБРО ПОЖАЛОВАТЬ НА БОРТ
            <span></span>
          </div>

          <h1 id="auth-title">С возвращением!</h1>
          <p class="subtitle" id="auth-subtitle">
            Войди в свой аккаунт, чтобы продолжить обучение.
          </p>

          <div class="tabs">
            <button class="tab active" type="button" data-mode="login">
              Вход
            </button>
            <button class="tab" type="button" data-mode="register">
              Регистрация
            </button>
          </div>

          <form id="auth-form">
            <label class="input-wrap">
              <span class="field-icon">⚓</span>
              <input
                id="server-url"
                type="url"
                value="http://127.0.0.1:8000"
                placeholder="Адрес сервера"
                required
              />
            </label>

            <label class="input-wrap">
              <span class="field-icon">♙</span>
              <input
                id="username"
                type="text"
                placeholder="Имя пользователя"
                minlength="3"
                maxlength="32"
                required
              />
            </label>

            <label class="input-wrap">
              <span class="field-icon lock">🔒</span>
              <input
                id="password"
                type="password"
                placeholder="Пароль"
                minlength="8"
                maxlength="128"
                required
              />
            </label>

            <p id="auth-message" class="message"></p>

            <button id="submit-button" class="primary-button" type="submit">
              <span>⛵</span> Войти
            </button>
          </form>

          <div class="card-footer">
            <span class="status-dot"></span>
            Подключение к серверу Sail Academy
          </div>
        </section>

        <footer class="scene-footer">
          <span></span>
          УЧИСЬ. ТРЕНИРУЙСЯ. ПОКОРЯЙ МОРЯ.
          <span></span>
        </footer>
      </main>
    `;

    document.body.append(this.root);
    this.root.querySelector<HTMLInputElement>("#server-url")!.value = window.location.origin;
    this.root.addEventListener("keydown", this.stopGameKeyboard);
    this.root.addEventListener("keyup", this.stopGameKeyboard);

    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          this.setMode(button.dataset.mode as AuthMode);
        });
      });

    this.root.querySelector<HTMLFormElement>("#auth-form")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submit();
      });
  }

  private setMode(mode: AuthMode): void {
    this.mode = mode;

    this.root.querySelector("#auth-title")!.textContent =
      mode === "login" ? "С возвращением!" : "Присоединяйся к нам!";

    this.root.querySelector("#auth-subtitle")!.textContent =
      mode === "login"
        ? "Войди в свой аккаунт, чтобы продолжить обучение."
        : "Создай аккаунт и начни своё путешествие.";

    this.root.querySelector("#submit-button")!.innerHTML =
      mode === "login" ? "<span>⛵</span> Войти" : "<span>⛵</span> Зарегистрироваться";

    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === mode);
      });

    this.showMessage("");
  }

  private async submit(): Promise<void> {
    const username = this.root.querySelector<HTMLInputElement>("#username")!.value.trim();
    const password = this.root.querySelector<HTMLInputElement>("#password")!.value;
    const serverUrl = this.root.querySelector<HTMLInputElement>("#server-url")!.value.trim();
    const button = this.root.querySelector<HTMLButtonElement>("#submit-button")!;

    button.disabled = true;
    this.showMessage("Подключаемся к серверу...");

    try {
      await this.onSubmit({
        serverUrl,
        username,
        password,
        mode: this.mode,
      });
    } catch (error) {
      this.showMessage(
        error instanceof Error ? error.message : "Неизвестная ошибка",
        true
      );
    } finally {
      button.disabled = false;
    }
  }

  private showMessage(message: string, isError = false): void {
    const element = this.root.querySelector("#auth-message")!;
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.classList.toggle("success", !isError && message.length > 0);
  }

  public show(): void {
    this.root.hidden = false;
  }

  public hide(): void {
    this.root.hidden = true;
  }

  public dispose(): void {
    this.root.remove();
    this.root.removeEventListener("keydown", this.stopGameKeyboard);
    this.root.removeEventListener("keyup", this.stopGameKeyboard);
  }
}
