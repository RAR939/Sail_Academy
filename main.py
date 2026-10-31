import os
import re
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "sail_academy.db"
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
password_hasher = PasswordHasher()

@asynccontextmanager
async def lifespan(app: FastAPI):
    with connect_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
    yield

def connect_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection

app = FastAPI(title="Sail Academy", lifespan=lifespan)

# Для локальной разработки можно оставить значение по умолчанию.
# Перед публикацией задайте переменную окружения SAIL_SESSION_SECRET.
SESSION_SECRET = os.getenv(
    "SAIL_SESSION_SECRET",
    "local-development-secret-change-before-deployment"
)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="sail_session",
    same_site="lax",
    https_only=False,  # Для production с HTTPS установить True.
    max_age=60 * 60 * 2,
)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

def error(message: str, status_code: int = 400):
    return JSONResponse({"ok": False, "message": message}, status_code=status_code)

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"username": request.session.get("username")},
    )

@app.post("/api/register")
async def register(request: Request):
    try:
        data = await request.json()
    except Exception:
        return error("Не удалось прочитать данные формы.")

    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9_-]{3,24}", username):
        return error("Имя: 3–24 символа, буквы, цифры, _ или -.")
    if len(password) < 10 or len(password) > 128:
        return error("Пароль должен содержать от 10 до 128 символов.")

    password_hash = password_hasher.hash(password)
    try:
        with connect_db() as db:
            cursor = db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return error("Такое имя уже занято.")

    request.session.clear()
    request.session["user_id"] = user_id
    request.session["username"] = username
    return {"ok": True, "message": "Регистрация успешна!"}

@app.post("/api/login")
async def login(request: Request):
    try:
        data = await request.json()
    except Exception:
        return error("Не удалось прочитать данные формы.")

    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    with connect_db() as db:
        user = db.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if user is None:
        return error("Неверное имя пользователя или пароль.", 401)
    try:
        password_hasher.verify(user["password_hash"], password)
    except (VerifyMismatchError, VerificationError):
        return error("Неверное имя пользователя или пароль.", 401)

    request.session.clear()
    request.session["user_id"] = user["id"]
    request.session["username"] = user["username"]
    return {"ok": True, "message": "Добро пожаловать!"}

@app.get("/api/me")
async def me(request: Request):
    if "user_id" not in request.session:
        return error("Требуется вход.", 401)
    return {"ok": True, "username": request.session["username"]}

@app.post("/api/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True, "message": "Ты вышел из аккаунта."}
