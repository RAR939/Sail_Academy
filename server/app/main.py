import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.auth import router as auth_router
from app.api.shore import router as shore_router
from app.api.admin import router as admin_router
from app.database.connection import init_db, close_db
from app.websocket.router import router as websocket_router
from app.game.game_loop import game_loop


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[2]
CLIENT_DIR = BASE_DIR / "client" / "dist"
ASSETS_DIR = CLIENT_DIR / "assets"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("%s starting...", settings.APP_NAME)
    logger.info("Version: %s", settings.APP_VERSION)

    game_task = asyncio.create_task(
        game_loop.start(),
        name="sail-academy-game-loop"
    )

    app.state.game_task = game_task

    try:
        yield
    finally:
        logger.info("Stopping game loop...")

        game_loop.stop()
        game_task.cancel()

        with suppress(asyncio.CancelledError):
            await game_task

        logger.info("Server shut down.")
        await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(shore_router)
app.include_router(admin_router)
app.include_router(websocket_router)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "application": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "game_loop": game_loop.running
    }


@app.get("/")
async def index():
    index_file = CLIENT_DIR / "index.html"

    if not index_file.exists():
        return {
            "status": "ok",
            "message": "Sail Academy server is running. Client is not built yet."
        }

    # The entry page names Vite's content-hashed assets and must be revalidated
    # after a new client build; browsers may cache the assets themselves.
    return FileResponse(index_file, headers={"Cache-Control": "no-cache"})


if ASSETS_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=ASSETS_DIR),
        name="assets"
    )

# Public files copied by Vite (for example the login background) live at the root.
if CLIENT_DIR.exists():
    app.mount("/", StaticFiles(directory=CLIENT_DIR, html=True), name="client")
