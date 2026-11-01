"""Grant/revoke admin access to existing accounts. Run from server/."""
import argparse
import asyncio
from sqlalchemy import select
from app.database.connection import AsyncSessionLocal
from app.database.models import User
from app.admin.access import admin_ids, write_admin_ids

async def main():
    parser = argparse.ArgumentParser(description='Права доступа к админ-панели')
    parser.add_argument('action', choices=['grant', 'revoke', 'list'])
    parser.add_argument('username', nargs='?')
    args = parser.parse_args()
    if args.action != 'list' and not args.username: parser.error('Укажите имя пользователя')
    async with AsyncSessionLocal() as session:
        ids = admin_ids()
        if args.action == 'list':
            users = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
            for user in users: print(f'{user.id}: {user.username}')
            if not users: print('Администраторов нет')
            return
        user = (await session.execute(select(User).where(User.username == args.username))).scalar_one_or_none()
        if user is None: raise SystemExit('Учётная запись не найдена')
        if args.action == 'grant': ids.add(user.id)
        else: ids.discard(user.id)
        write_admin_ids(ids)
        print(f'{args.action}: {user.username} (id {user.id})')

if __name__ == '__main__': asyncio.run(main())
