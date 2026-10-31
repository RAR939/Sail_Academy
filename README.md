# Sail Academy — экран входа

## Запуск на Windows PowerShell

1. Установи Python 3.12.10 с https://www.python.org/downloads/release/python-31210/ и отметь `Add Python to PATH`.
2. Открой PowerShell в папке, куда распаковал проект, и выполни:

```powershell
py -3.12 --version
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

3. Открой http://127.0.0.1:8000

Если PowerShell запрещает активацию окружения, открой обычный `cmd.exe` в папке проекта и выполни:

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Остановить сервер: `Ctrl+C`.

## Что работает
- Переключение вкладок «Вход» / «Регистрация».
- Проверка полей на стороне браузера и сервера.
- Регистрация и вход с хешированием паролей Argon2.
- SQLite-база `sail_academy.db` создаётся автоматически.
- Переключатель видимости пароля.
- Проверка активной сессии и выход из аккаунта.
- Адаптивная верстка для узких экранов.

## Название и шрифт
В `static/app.js` поменяй `const BRAND_TITLE = "Sail Academy";`.
В `static/style.css` настройка `--brand-font` задаёт шрифт заголовка. Чтобы браузер гарантированно использовал Christmas Script Air на любом компьютере, установи этот шрифт в Windows либо добавь разрешённый к использованию файл шрифта локально в `static` и подключи его через `@font-face`. Внешние CDN не используются.

## Важно
Это локальный прототип. Перед публикацией в интернете замени `SAIL_SESSION_SECRET` на длинный случайный секрет, включи HTTPS и `https_only=True`, а также добавь ограничение частоты попыток входа и защиту от CSRF. JWT и WebSocket-протокол игры в этом этапе ещё не реализованы.
