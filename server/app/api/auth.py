from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db
from app.database.models import User, Profile
from app.api.schemas import (
    RegisterRequest,
    LoginRequest,
    UserResponse,
    TokenResponse,
)
from app.security.passwords import hash_password, verify_password
from app.security.tokens import create_access_token
from app.security.dependencies import get_current_user
from app.config import settings


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    data: RegisterRequest,
    session: AsyncSession = Depends(get_db),
):
    username = data.username.strip()

    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя пользователя не может быть пустым",
        )

    result = await session.execute(
        select(User).where(User.username == username)
    )

    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Это имя пользователя уже занято",
        )

    user = User(
        username=username,
        password_hash=hash_password(data.password),
    )

    profile = Profile(
        display_name=data.display_name or username,
        user=user,
    )

    session.add(user)
    session.add(profile)

    try:
        await session.commit()
        await session.refresh(user)
        await session.refresh(profile)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Это имя пользователя уже занято",
        )

    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=profile.display_name,
        created_at=user.created_at,
    )


@router.post(
    "/login",
    response_model=TokenResponse,
)
async def login(
    data: LoginRequest,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(User).where(User.username == data.username.strip())
    )

    user = result.scalar_one_or_none()

    if user is None or not verify_password(
        data.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверное имя пользователя или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аккаунт заблокирован",
        )

    token = create_access_token(user.id)

    return TokenResponse(
        access_token=token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get(
    "/me",
    response_model=UserResponse,
)
async def get_me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload

    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user.id)
    )

    user = result.scalar_one()

    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.profile.display_name,
        created_at=user.created_at,
    )
