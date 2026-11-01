import argparse
import socket
import ipaddress
import shutil
import subprocess
from pathlib import Path

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


def create_certificate(ip: str, directory: Path, openssl: str | None = None):
    """Generate a local certificate without overwriting existing key material."""
    ipaddress.ip_address(ip)
    directory.mkdir(parents=True, exist_ok=True)
    cert, key, addresses = directory / "lan-cert.pem", directory / "lan-key.pem", directory / "lan-ip.txt"
    if cert.exists() or key.exists() or addresses.exists():
        if not (cert.is_file() and key.is_file() and addresses.is_file() and addresses.read_text().strip() == ip):
            raise RuntimeError("Сертификат для другого IP или его файлы неполные. Укажите новую папку через --cert-dir.")
        return cert, key
    executable = openssl or shutil.which("openssl")
    if not executable:
        git_openssl = Path("C:/Program Files/Git/usr/bin/openssl.exe")
        executable = str(git_openssl) if git_openssl.exists() else None
    if not executable:
        raise RuntimeError("OpenSSL не найден. Установите OpenSSL или Git for Windows.")
    subprocess.run([
        executable, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
        "-keyout", str(key), "-out", str(cert), "-days", "365",
        "-subj", "/CN=Sail Academy Local", "-addext",
        f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
        "-addext", "extendedKeyUsage=serverAuth",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    addresses.write_text(ip, encoding="ascii")
    return cert, key


def main():
    parser = argparse.ArgumentParser(
        description="Sail Academy Server"
    )

    parser.add_argument(
        "--lan",
        action="store_true",
        help="Запустить сервер для локальной сети"
    )

    parser.add_argument("--https", action="store_true", help="Включить HTTPS/WSS")
    parser.add_argument("--cert-dir", type=Path, default=Path(__file__).resolve().parent / "certs", help="Папка сертификата")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else settings.HOST

    print("=" * 40)
    print("       SAIL ACADEMY SERVER")
    print("=" * 40)

    ip = get_local_ip() if args.lan else "127.0.0.1"
    ssl_options = {}
    if args.https:
        try:
            cert, key = create_certificate(ip, args.cert_dir)
        except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            parser.error(f"Не удалось подготовить сертификат: {error}")
        ssl_options = {"ssl_certfile": str(cert), "ssl_keyfile": str(key)}
        print(f"Сертификат для установки на устройства: {cert}")
    scheme = "https" if args.https else "http"
    if args.lan:
        print(f"LAN: {scheme}://{ip}:{settings.PORT}")
    else:
        print(f"Local: {scheme}://127.0.0.1:{settings.PORT}")

    print("=" * 40)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=settings.PORT,
        reload=settings.DEBUG,
        **ssl_options,
    )


if __name__ == "__main__":
    main()
