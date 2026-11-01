from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./sail_academy.db"

    APP_NAME: str = "Sail Academy"
    APP_VERSION: str = "1.0.0"

    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = False

    OLLAMA_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen3:4b-instruct"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    RAG_ENABLED: bool = True
    RAG_TOP_K: int = Field(default=4, ge=1, le=20)
    RAG_MIN_SIMILARITY: float = Field(default=0.73, gt=0, le=1)
    RAG_INDEX_PATH: str = "./rag_index.sqlite3"
    OLLAMA_TIMEOUT_SECONDS: float = Field(default=35, gt=0, le=120)

    JWT_SECRET: str = Field(min_length=32)
    JWT_ALGORITHM: Literal["HS256"] = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60, gt=0)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
