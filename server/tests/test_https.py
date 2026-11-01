"""Checks certificate identity, reuse and protection against accidental overwrite."""
import os
import shutil
import ssl
from pathlib import Path

import pytest

os.environ.setdefault("JWT_SECRET", "test-https-secret-only-0000000000000000000")
from start import create_certificate


def test_local_certificate_has_lan_and_localhost_san_and_reuses_key(tmp_path):
    executable = shutil.which("openssl")
    git_openssl = Path("C:/Program Files/Git/usr/bin/openssl.exe")
    if not executable and git_openssl.is_file():
        executable = str(git_openssl)
    if not executable:
        pytest.skip("OpenSSL is unavailable")
    cert, key = create_certificate("192.168.10.15", tmp_path, executable)
    info = ssl._ssl._test_decode_cert(str(cert))
    names = set(info["subjectAltName"])
    assert ("IP Address", "192.168.10.15") in names
    assert ("IP Address", "127.0.0.1") in names
    assert ("DNS", "localhost") in names
    original_key = key.read_bytes()
    assert create_certificate("192.168.10.15", tmp_path, executable) == (cert, key)
    assert key.read_bytes() == original_key
    with pytest.raises(RuntimeError):
        create_certificate("192.168.10.16", tmp_path, executable)
    assert key.read_bytes() == original_key
    if os.name != "nt":
        assert key.stat().st_mode & 0o077 == 0
