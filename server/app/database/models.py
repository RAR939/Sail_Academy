from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    Float,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    profile: Mapped["Profile"] = relationship(
        back_populates="user",
        uselist=False,
    )
    progress: Mapped[list["Progress"]] = relationship(back_populates="user")
    npc_memories: Mapped[list["NPCMemory"]] = relationship(back_populates="user")
    race_participations: Mapped[list["RaceParticipant"]] = relationship(
        back_populates="user"
    )


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
    )
    display_name: Mapped[str] = mapped_column(String(40))
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    settings: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="profile")


class Progress(Base):
    __tablename__ = "progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    course_id: Mapped[str] = mapped_column(String(64))
    lesson_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user: Mapped["User"] = relationship(back_populates="progress")

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", "lesson_id"),
    )


class NPCMemory(Base):
    __tablename__ = "npc_memories"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    npc_id: Mapped[str] = mapped_column(String(64))
    memory_text: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user: Mapped["User"] = relationship(back_populates="npc_memories")

    __table_args__ = (
        UniqueConstraint("user_id", "npc_id"),
    )


class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="waiting")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    participants: Mapped[list["RaceParticipant"]] = relationship(
        back_populates="race"
    )
    events: Mapped[list["RaceEvent"]] = relationship(back_populates="race")


class RaceParticipant(Base):
    __tablename__ = "race_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    finish_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    finish_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    penalty_points: Mapped[int] = mapped_column(Integer, default=0)

    race: Mapped["Race"] = relationship(back_populates="participants")
    user: Mapped["User"] = relationship(back_populates="race_participations")

    __table_args__ = (
        UniqueConstraint("race_id", "user_id"),
    )


class RaceEvent(Base):
    __tablename__ = "race_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
    )

    event_type: Mapped[str] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    race: Mapped["Race"] = relationship(back_populates="events")
