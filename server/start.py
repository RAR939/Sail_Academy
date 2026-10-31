import argparse
import socket

import uvicorn

from app.config import settings


def get_local_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    try:
        sock.connect(("192.0.2.1", 80))
        return sock.getsockname()[0]
    except OSError:
        return "IP не определён"
    finally:
        sock.close()


def main():
    parser = argparse.ArgumentParser(
        description="Sail Academy Server"
    )

    parser.add_argument(
        "--lan",
        action="store_true",
        help="Запустить сервер для локальной сети"
    )

    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else settings.HOST

    print("=" * 40)
    print("       SAIL ACADEMY SERVER")
    print("=" * 40)

    if args.lan:
        print(f"LAN: http://{get_local_ip()}:{settings.PORT}")
    else:
        print(f"Local: http://127.0.0.1:{settings.PORT}")

    print("=" * 40)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=settings.PORT,
        reload=settings.DEBUG
    )


if __name__ == "__main__":
    main()
