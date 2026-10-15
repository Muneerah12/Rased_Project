import importlib.util
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests
import trustme


BACKEND_DIR = Path(__file__).resolve().parents[1]
SIMULATOR_DIR = BACKEND_DIR.parent / "simulator"


def load_simulator(path, monkeypatch):
    monkeypatch.setenv("DEVICE_CREDENTIAL", "simulator-test-credential")
    monkeypatch.setenv("CPS_BACKEND_URL", "https://localhost:8000")
    module_name = "transport_test_" + path.stem
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_maintained_simulator_requires_https_and_passes_ca_bundle(monkeypatch):
    module = load_simulator(SIMULATOR_DIR / "simulator.py", monkeypatch)
    monkeypatch.setenv("CPS_CA_BUNDLE", "trusted-ca.pem")
    url, verify = module.get_transport_config()
    assert url == "https://localhost:8000/readings"
    assert verify == "trusted-ca.pem"

    monkeypatch.setenv("CPS_BACKEND_URL", "http://localhost:8000")
    with pytest.raises(RuntimeError, match="valid HTTPS URL"):
        module.get_transport_config()

    monkeypatch.setenv("CPS_BACKEND_URL", "https://:8000")
    with pytest.raises(RuntimeError, match="valid HTTPS URL"):
        module.get_transport_config()


@pytest.fixture(scope="module")
def tls_backend(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("tls")
    ca = trustme.CA()
    server_cert = ca.issue_cert("localhost")
    cert_path = tmp_path / "server.pem"
    key_path = tmp_path / "server-key.pem"
    ca_path = tmp_path / "ca.pem"
    server_cert.cert_chain_pems[0].write_to_path(cert_path)
    server_cert.private_key_pem.write_to_path(key_path)
    ca.cert_pem.write_to_path(ca_path)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(port),
            "--ssl-certfile",
            str(cert_path),
            "--ssl-keyfile",
            str(key_path),
        ],
        cwd=BACKEND_DIR,
        env={**os.environ, "ADMIN_PROVISIONING_TOKEN": "https-test-admin"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base_url = f"https://localhost:{port}"

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Uvicorn exited before the TLS test server started")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    else:
        process.terminate()
        raise RuntimeError("Timed out waiting for the TLS test server")

    try:
        yield base_url, ca_path, ca
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def test_https_request_succeeds_with_trusted_ca_and_matching_hostname(tls_backend):
    base_url, ca_path, _ = tls_backend
    response = requests.get(f"{base_url}/", verify=str(ca_path), timeout=5)
    assert response.status_code == 200
    assert response.json() == {"message": "CPS Backend is running"}


def test_https_rejects_untrusted_ca(tls_backend, tmp_path):
    base_url, _, _ = tls_backend
    untrusted_ca_path = tmp_path / "untrusted-ca.pem"
    trustme.CA().cert_pem.write_to_path(untrusted_ca_path)
    with pytest.raises(requests.exceptions.SSLError):
        requests.get(
            f"{base_url}/",
            verify=str(untrusted_ca_path),
            timeout=5,
        )


def test_https_rejects_hostname_mismatch(tls_backend):
    base_url, ca_path, _ = tls_backend
    mismatched_url = base_url.replace("localhost", "127.0.0.1")
    with pytest.raises(requests.exceptions.SSLError):
        requests.get(mismatched_url, verify=str(ca_path), timeout=5)


def test_tls_listener_does_not_accept_plain_http(tls_backend):
    base_url, _, _ = tls_backend
    http_url = base_url.replace("https://", "http://", 1)
    with pytest.raises(requests.exceptions.RequestException):
        requests.get(http_url, timeout=5)
