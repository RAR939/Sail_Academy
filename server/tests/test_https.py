"""Checks certificate identity, reuse and protection against accidental overwrite."""
import os
import ssl

import pytest

os.environ.setdefault("JWT_SECRET", "test-https-secret-only-0000000000000000000")
from start import create_certificate, certificate_directory, find_openssl


def test_local_certificate_has_lan_and_localhost_san_and_reuses_key(tmp_path):
    try:
        executable = find_openssl()
    except RuntimeError:
        pytest.skip("OpenSSL is unavailable")
    cert, key = create_certificate("192.168.10.15", tmp_path, executable)
    ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER).load_cert_chain(str(cert), str(key))
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


def test_incomplete_or_other_ip_uses_separate_directory(tmp_path):
    (tmp_path / "lan-ip.txt").write_text("192.168.1.2")
    chosen = certificate_directory("192.168.1.3", tmp_path)
    assert chosen == tmp_path / "ip-192.168.1.3"
    assert (tmp_path / "lan-ip.txt").read_text() == "192.168.1.2"
    chosen.mkdir()
    (chosen / "lan-ip.txt").write_text("192.168.1.3")
    assert certificate_directory("192.168.1.3", tmp_path) == tmp_path / "ip-192.168.1.3-1"
