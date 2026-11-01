import argparse
import socket
import ipaddress
import os
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


def find_openssl():
    candidates = [shutil.which("openssl")]
    if os.name == "nt":
        # Git's usr/bin binary may depend on unavailable MSYS DLLs; the UCRT
        # build is self-contained when invoked from Python on Windows.
        candidates.extend(["C:/Program Files/Git/ucrt64/bin/openssl.exe", "C:/Program Files/Git/usr/bin/openssl.exe"])
    for candidate in candidates:
        if not candidate or not Path(candidate).is_file():
            continue
        try:
            subprocess.run([candidate, "version"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            return candidate
        except (OSError, subprocess.SubprocessError):
            continue
    raise RuntimeError("Рабочий OpenSSL не найден. Установите OpenSSL или Git for Windows и перезапустите терминал.")


def certificate_directory(ip: str, directory: Path) -> Path:
    """Keep existing keys intact, use a separate folder for another IP or broken files."""
    def state(path):
        cert, key, addresses = path / "lan-cert.pem", path / "lan-key.pem", path / "lan-ip.txt"
        if not any(p.exists() for p in (cert, key, addresses)):
            return "empty"
        if cert.is_file() and key.is_file() and addresses.is_file() and addresses.read_text(encoding="ascii").strip() == ip:
            return "ready"
        return "occupied"

    if state(directory) != "occupied":
        return directory
    for index in range(1000):
        candidate = directory / (f"ip-{ip}" + (f"-{index}" if index else ""))
        if state(candidate) != "occupied":
            return candidate
    raise RuntimeError("Не удалось подобрать отдельную папку для сертификата. Укажите --cert-dir.")


def create_certificate(ip: str, directory: Path, openssl: str | None = None):
    """Generate a local certificate without overwriting existing key material."""
    ipaddress.ip_address(ip)
    directory.mkdir(parents=True, exist_ok=True)
    cert, key, addresses = directory / "lan-cert.pem", directory / "lan-key.pem", directory / "lan-ip.txt"
    if cert.exists() or key.exists() or addresses.exists():
        if not (cert.is_file() and key.is_file() and addresses.is_file() and addresses.read_text().strip() == ip):
            raise RuntimeError("Сертификат для другого IP или его файлы неполные. Укажите новую папку через --cert-dir.")
        return cert, key
    executable = openssl or find_openssl()
    previous_umask = os.umask(0o077)
    try:
        subprocess.run([
            executable, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
            "-keyout", str(key), "-out", str(cert), "-days", "365",
            "-subj", "/CN=Sail Academy Local", "-addext",
            f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
            "-addext", "extendedKeyUsage=serverAuth",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    finally:
        os.umask(previous_umask)
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
    parser.add_argument("--ip", help="IPv4 сервера в локальной сети")
    parser.add_argument("--cert-dir", type=Path, default=Path(__file__).resolve().parent / "certs", help="Папка сертификата")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else settings.HOST

    print("=" * 40)
    print("       SAIL ACADEMY SERVER")
    print("=" * 40)

    if args.ip and not args.lan:
        parser.error("Параметр --ip используется вместе с --lan")
    ip = args.ip or (get_local_ip() if args.lan else "127.0.0.1")
    try:
        if ipaddress.ip_address(ip).version != 4:
            raise ValueError("Требуется IPv4")
    except ValueError:
        parser.error("Не удалось определить IPv4. Укажите адрес вручную: --lan --ip 192.168.1.10")
    ssl_options = {}
    if args.https:
        try:
            cert_dir = certificate_directory(ip, args.cert_dir)
            cert, key = create_certificate(ip, cert_dir)
        except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
            detail = error.stderr.decode(errors="replace").strip() if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
            parser.error(f"Не удалось подготовить сертификат: {detail}")
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
