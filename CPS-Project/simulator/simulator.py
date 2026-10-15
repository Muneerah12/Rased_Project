import os
import random
import time
import requests
from datetime import datetime, timezone
from urllib.parse import urlsplit


NODE_ID = "NODE-01"
BACKEND_URL_ENV = "CPS_BACKEND_URL"
CA_BUNDLE_ENV = "CPS_CA_BUNDLE"

# Read from the environment so no secret is stored in source code.
DEVICE_CREDENTIAL = os.environ.get("DEVICE_CREDENTIAL")

if not DEVICE_CREDENTIAL:
    raise SystemExit("DEVICE_CREDENTIAL environment variable is not set.")


def get_transport_config():
    backend_url = os.environ.get(BACKEND_URL_ENV)
    if not backend_url:
        raise RuntimeError(f"{BACKEND_URL_ENV} environment variable is not set.")

    parsed_url = urlsplit(backend_url)
    if parsed_url.scheme.lower() != "https" or not parsed_url.hostname:
        raise RuntimeError(f"{BACKEND_URL_ENV} must be a valid HTTPS URL.")

    # Requests verifies certificates by default. A private CA bundle can be
    # supplied for a local/MVP deployment; never disable verification.
    ca_bundle = os.environ.get(CA_BUNDLE_ENV) or True
    return backend_url.rstrip("/") + "/readings", ca_bundle


# Send sensor readings every 10 seconds
READING_INTERVAL = 10

# Local buffer for readings that could not be delivered
pending_readings = []


def send_reading(reading):
    headers = {
        "X-Device-Credential": DEVICE_CREDENTIAL
    }

    try:
        backend_url, ca_bundle = get_transport_config()
        response = requests.post(
            backend_url,
            json=reading,
            headers=headers,
            timeout=5,
            verify=ca_bundle
        )

        print(
            f"{reading['sensor_type']}: "
            f"{reading['value']} {reading['unit']} "
            f"→ HTTP {response.status_code}"
        )

        if response.ok:
            print("Reading delivered successfully.")
            return True

        else:
            print("Reading was not accepted. Saving locally.")
            pending_readings.append(reading)
            return False

    except requests.RequestException as error:
        print(f"Connection error: {error}")
        print("Saving reading locally.")

        pending_readings.append(reading)

        return False


def resend_pending_readings():
    if not pending_readings:
        return

    print(
        f"Connection restored. "
        f"Attempting to resend {len(pending_readings)} pending readings..."
    )

    # Take a snapshot of the pending readings
    readings_to_resend = pending_readings.copy()

    # Clear the buffer before retrying.
    # Failed retries will be added back by send_reading().
    pending_readings.clear()

    for reading in readings_to_resend:
        if send_reading(reading):
            print(
                f"Successfully resent "
                f"{reading['sensor_type']} reading."
            )
        else:
            print(
                f"Could not resend "
                f"{reading['sensor_type']} reading."
            )

    print(
        f"Pending readings remaining: "
        f"{len(pending_readings)}"
    )


def generate_bme280_readings():
    timestamp = datetime.now(timezone.utc)

    # Create a common environmental temperature
    base_temperature = random.uniform(20, 30)

    # Simulate three temperature sensors measuring the same environment
    temperature_1 = round(
        base_temperature + random.uniform(-0.3, 0.3), 2
    )

    temperature_2 = round(
        base_temperature + random.uniform(-0.3, 0.3), 2
    )

    temperature_3 = round(
        base_temperature + random.uniform(-0.3, 0.3), 2
    )

    humidity = round(random.uniform(40, 70), 2)
    pressure = round(random.uniform(1000, 1020), 2)

    return [
        {
            "node_id": NODE_ID,
            "sensor_id": "TEMP-01",
            "sensor_type": "temperature",
            "value": temperature_1,
            "unit": "C",
            "timestamp": timestamp.isoformat()
        },
        {
            "node_id": NODE_ID,
            "sensor_id": "TEMP-02",
            "sensor_type": "temperature",
            "value": temperature_2,
            "unit": "C",
            "timestamp": timestamp.isoformat()
        },
        {
            "node_id": NODE_ID,
            "sensor_id": "TEMP-03",
            "sensor_type": "temperature",
            "value": temperature_3,
            "unit": "C",
            "timestamp": timestamp.isoformat()
        },
        {
            "node_id": NODE_ID,
            "sensor_id": "BME280-01",
            "sensor_type": "humidity",
            "value": humidity,
            "unit": "%",
            "timestamp": timestamp.isoformat()
        },
        {
            "node_id": NODE_ID,
            "sensor_id": "BME280-01",
            "sensor_type": "pressure",
            "value": pressure,
            "unit": "hPa",
            "timestamp": timestamp.isoformat()
        }
    ]


def main():
    try:
        backend_url, _ = get_transport_config()
    except RuntimeError as error:
        raise SystemExit(str(error)) from error

    print(f"Starting simulated node: {NODE_ID}")
    print(f"Using HTTPS backend: {backend_url}")
    print(f"Sending readings every {READING_INTERVAL} seconds")
    print("Press CTRL+C to stop.")
    print()

    try:
        while True:
            print("Generating new sensor readings...")

            # Retry old readings first
            resend_pending_readings()

            # Generate new readings
            readings = generate_bme280_readings()

            # Send each reading
            for reading in readings:
                send_reading(reading)

            print(
                f"Pending unsent readings: "
                f"{len(pending_readings)}"
            )

            print()
            print(
                f"Waiting {READING_INTERVAL} seconds..."
            )
            print()

            time.sleep(READING_INTERVAL)

    except KeyboardInterrupt:
        print()
        print("Simulator stopped.")


if __name__ == "__main__":
    main()
