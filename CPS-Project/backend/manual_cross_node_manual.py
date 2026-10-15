import getpass
from datetime import datetime, timezone
import requests

URL = "http://127.0.0.1:8000/readings"

print("=== CPS Cross-Node Agreement Test ===")
print()

credential_01 = getpass.getpass("NODE-01 credential: ")
credential_02 = getpass.getpass("NODE-02 credential: ")


def send_reading(credential, node_id, sensor_id, value):
    timestamp = datetime.now(timezone.utc).isoformat()

    payload = {
        "node_id": node_id,
        "sensor_id": sensor_id,
        "sensor_type": "temperature",
        "value": value,
        "unit": "°C",
        "timestamp": timestamp,
    }

    response = requests.post(
        URL,
        json=payload,
        headers={"X-Device-Credential": credential},
        timeout=5,
    )

    print(
        f"{node_id} | {sensor_id} | {value}°C "
        f"| HTTP {response.status_code}"
    )
    print(response.json())
    print()

    return response


print("----- NODE-01 -----")

for sensor_id, value in [
    ("TEMP-01", 25.0),
    ("TEMP-02", 25.1),
    ("TEMP-03", 24.9),
]:
    send_reading(
        credential_01,
        "NODE-01",
        sensor_id,
        value,
    )


print("----- NODE-02 -----")

for sensor_id, value in [
    ("TEMP-01", 25.0),
    ("TEMP-02", 25.1),
    ("TEMP-03", 24.9),
]:
    send_reading(
        credential_02,
        "NODE-02",
        sensor_id,
        value,
    )


print("=== Test complete ===")