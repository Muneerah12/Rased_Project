#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <math.h>
#include <time.h>

#include "secrets.h"

// BACKEND_URL may be https:// (verified against LOCAL_ROOT_CA_CERT) or plain
// http:// for a backend on a private network without the TLS proxy.
static bool beginBackend(HTTPClient &http, WiFiClient &plainClient,
                         WiFiClientSecure &secureClient, const String &url) {
    if (url.startsWith("https://")) {
        secureClient.setCACert(LOCAL_ROOT_CA_CERT);
        return http.begin(secureClient, url);
    }
    return http.begin(plainClient, url);
}

static const char ROOT_CA_CERT[] =
"-----BEGIN CERTIFICATE-----\n"
"MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
"A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
"b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
"MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
"YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
"aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
"jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
"xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
"1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
"snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
"U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
"9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
"BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
"AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
"yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
"38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
"AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
"DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
"HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
"-----END CERTIFICATE-----\n";

Adafruit_BME280 bme;

// =========================
// Configuration
// =========================

const unsigned long READING_INTERVAL = 3000;      // 3 seconds
const unsigned long HEARTBEAT_INTERVAL = 10000;   // 10 seconds
constexpr uint8_t HVAC_RELAY_PIN = 25;
constexpr float HVAC_SETPOINT_C = 25.0F;
constexpr float HVAC_TURN_ON_C = HVAC_SETPOINT_C + 1.0F;
constexpr float HVAC_TURN_OFF_C = HVAC_SETPOINT_C - 1.0F;
const unsigned long HVAC_MINIMUM_ON_TIME = 60UL * 1000UL;
const unsigned long HVAC_MINIMUM_OFF_TIME = 60UL * 1000UL;

unsigned long lastReadingTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastHvacStateChange = 0;
bool hvacIsOn = false;

// =========================
// Function declarations
// =========================

bool connectWiFi();
void sendHeartbeat();
void sendTemperatureReading(float temperature);
void sendHumidityReading(float humidity);
void sendPressureReading(float pressure);

String getUTCTimestamp();
void controlHvac(float temperature);

// =========================
// Setup
// =========================

void setup() {

    pinMode(HVAC_RELAY_PIN, OUTPUT);
    digitalWrite(HVAC_RELAY_PIN, LOW);
    hvacIsOn = false;
    lastHvacStateChange = millis();

    Serial.begin(9600);
    delay(1000);

    Serial.println();
    Serial.println("================================");
    Serial.println("CPS ESP32 NODE");
    Serial.println("================================");

    // =========================
    // BME280
    // =========================

    Wire.begin(21, 22);

    Serial.println();
    Serial.println("Initializing BME280...");

    if (!bme.begin(0x76)) {

        Serial.println("Could not find BME280!");

        while (1) {
            delay(1000);
        }
    }

    Serial.println("BME280 initialized successfully!");

    // =========================
    // Wi-Fi
    // =========================

    connectWiFi();

    // =========================
    // Time synchronization
    // =========================

    Serial.println();
    Serial.println("Synchronizing time...");

    configTime(0, 0, "pool.ntp.org", "time.nist.gov");

    struct tm timeinfo;

    int attempts = 0;

    while (!getLocalTime(&timeinfo) && attempts < 20) {

        delay(500);
        Serial.print(".");
        attempts++;
    }

    Serial.println();

    if (getLocalTime(&timeinfo)) {

        Serial.println("Time synchronized!");

        Serial.print("UTC time: ");
        Serial.println(getUTCTimestamp());

    } else {

        Serial.println("Time synchronization failed.");
    }

    Serial.println();
    Serial.println("CPS node started.");
    Serial.print("Node ID: ");
    Serial.println(NODE_ID);
}

// =========================
// Main Loop
// =========================

void loop() {

    unsigned long currentTime = millis();
    const bool readingDue = currentTime - lastReadingTime >= READING_INTERVAL;
    float temperature = NAN;
    float humidity = NAN;
    float pressure = NAN;

    // Read and control locally before any potentially blocking network work.
    if (readingDue) {
        temperature = bme.readTemperature();
        humidity = bme.readHumidity();
        pressure = bme.readPressure() / 100.0F;

        Serial.println();
        Serial.println("========== SENSOR DATA ==========");

        Serial.print("Temperature: ");
        Serial.print(temperature);
        Serial.println(" C");
        controlHvac(temperature);

        Serial.print("Humidity: ");
        Serial.print(humidity);
        Serial.println(" %");

        Serial.print("Pressure: ");
        Serial.print(pressure);
        Serial.println(" hPa");

        Serial.println("=================================");
        lastReadingTime = currentTime;
    }

    // Keep the existing Wi-Fi reconnect flow. Sensor control above is local
    // and still runs before a reconnect attempt can block.
    if (WiFi.status() != WL_CONNECTED) {

        Serial.println();
        Serial.println("Wi-Fi disconnected.");

        connectWiFi();

        delay(1000);

        return;
    }

    currentTime = millis();

    // =========================
    // Heartbeat
    // =========================

    if (currentTime - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {

        sendHeartbeat();

        lastHeartbeatTime = currentTime;
    }

    // Send the readings only when connected, as before.
    if (readingDue) {
        sendTemperatureReading(temperature);
        sendHumidityReading(humidity);
        sendPressureReading(pressure);
    }

    delay(100);
}

// =========================
// Local HVAC Control
// =========================

void controlHvac(float temperature) {

    const unsigned long currentTime = millis();
    const bool temperatureIsValid = isfinite(temperature)
        && temperature >= -40.0F
        && temperature <= 85.0F;

    if (!temperatureIsValid) {
        Serial.print("HVAC controller: invalid BME280 temperature (");
        Serial.print(temperature);
        Serial.println(" C); forcing HVAC OFF.");

        if (hvacIsOn) {
            digitalWrite(HVAC_RELAY_PIN, LOW);
            hvacIsOn = false;
            lastHvacStateChange = currentTime;
            Serial.println("HVAC state changed: ON -> OFF (invalid sensor reading)");
        } else {
            digitalWrite(HVAC_RELAY_PIN, LOW);
        }
        return;
    }

    Serial.print("HVAC controller temperature read: ");
    Serial.print(temperature, 2);
    Serial.println(" C");

    if (temperature >= HVAC_TURN_ON_C && !hvacIsOn) {
        const unsigned long offDuration = currentTime - lastHvacStateChange;
        if (offDuration < HVAC_MINIMUM_OFF_TIME) {
            Serial.print("HVAC remains OFF: minimum OFF time prevents start (");
            Serial.print((HVAC_MINIMUM_OFF_TIME - offDuration) / 1000UL);
            Serial.println(" seconds remaining).");
            return;
        }

        digitalWrite(HVAC_RELAY_PIN, HIGH);
        hvacIsOn = true;
        lastHvacStateChange = currentTime;
        Serial.println("HVAC state changed: OFF -> ON");
        return;
    }

    if (temperature <= HVAC_TURN_OFF_C && hvacIsOn) {
        const unsigned long onDuration = currentTime - lastHvacStateChange;
        if (onDuration < HVAC_MINIMUM_ON_TIME) {
            Serial.print("HVAC remains ON: minimum ON time prevents stop (");
            Serial.print((HVAC_MINIMUM_ON_TIME - onDuration) / 1000UL);
            Serial.println(" seconds remaining).");
            return;
        }

        digitalWrite(HVAC_RELAY_PIN, LOW);
        hvacIsOn = false;
        lastHvacStateChange = currentTime;
        Serial.println("HVAC state changed: ON -> OFF");
        return;
    }

    if (temperature > HVAC_TURN_OFF_C && temperature < HVAC_TURN_ON_C) {
        Serial.print("HVAC keeps current state in temperature deadband: ");
        Serial.println(hvacIsOn ? "ON" : "OFF");
    }
}

// =========================
// Wi-Fi Connection
// =========================

bool connectWiFi() {

    Serial.println();
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(WIFI_SSID);

    WiFi.mode(WIFI_STA);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;

    while (WiFi.status() != WL_CONNECTED && attempts < 40) {

        delay(500);
        Serial.print(".");

        attempts++;
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {

        Serial.println("Wi-Fi connected!");

        Serial.print("ESP32 IP address: ");
        Serial.println(WiFi.localIP());

        Serial.print("Signal strength: ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");

        return true;

    } else {

        Serial.println("Wi-Fi connection failed.");

        Serial.print("Wi-Fi status: ");
        Serial.println(WiFi.status());

        return false;
    }
}

// =========================
// UTC Timestamp
// =========================

String getUTCTimestamp() {

    struct tm timeinfo;

    if (!getLocalTime(&timeinfo)) {

        return "";
    }

    char timestamp[30];

    strftime(
        timestamp,
        sizeof(timestamp),
        "%Y-%m-%dT%H:%M:%SZ",
        &timeinfo
    );

    return String(timestamp);
}

// =========================
// Send Heartbeat
// =========================

String jsonEscape(const String& value) {
    String escaped;
    const char hex[] = "0123456789abcdef";
    for (size_t index = 0; index < value.length(); index++) {
        const uint8_t character = static_cast<uint8_t>(value[index]);
        if (character == '"') escaped += "\\\"";
        else if (character == '\\') escaped += "\\\\";
        else if (character == '\b') escaped += "\\b";
        else if (character == '\f') escaped += "\\f";
        else if (character == '\n') escaped += "\\n";
        else if (character == '\r') escaped += "\\r";
        else if (character == '\t') escaped += "\\t";
        else if (character < 0x20) {
            escaped += "\\u00";
            escaped += hex[(character >> 4) & 0x0f];
            escaped += hex[character & 0x0f];
        } else escaped += static_cast<char>(character);
    }
    return escaped;
}

String jsonStringOrNull(const String& value) {
    if (value.length() == 0) return "null";
    return String("\"") + jsonEscape(value) + "\"";
}

void sendHeartbeat() {

    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    String timestamp = getUTCTimestamp();

    if (timestamp == "") {

        Serial.println("Heartbeat skipped: no valid UTC time.");
        return;
    }

    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    HTTPClient http;

    String url = String(BACKEND_URL) + "/heartbeat";

    Serial.println();
    Serial.println("Sending heartbeat...");

    beginBackend(http, plainClient, secureClient, url);

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Credential", DEVICE_CREDENTIAL);

    const String localIp = WiFi.localIP().toString();
    const String reportedSsid = WiFi.SSID();
    const String reportedBssid = WiFi.BSSIDstr();
    const String gateway = WiFi.gatewayIP().toString();
    const String subnetMask = WiFi.subnetMask().toString();
    const int wifiChannel = WiFi.channel();
    const String reportedGateway = gateway == "0.0.0.0" ? String("") : gateway;
    const String reportedSubnetMask = subnetMask == "0.0.0.0" ? String("") : subnetMask;

    Serial.println("===== NETWORK DEBUG =====");
    Serial.print("SSID: ");
    Serial.println(reportedSsid);
    Serial.print("BSSID: ");
    Serial.println(reportedBssid);
    Serial.print("Channel: ");
    Serial.println(wifiChannel);
    Serial.print("Gateway: ");
    Serial.println(gateway);
    Serial.print("Subnet: ");
    Serial.println(subnetMask);

    String payload = "{";
    payload += "\"node_id\":" + jsonStringOrNull(String(NODE_ID)) + ",";
    payload += "\"timestamp\":" + jsonStringOrNull(timestamp) + ",";
    payload += "\"reported_ip\":" + jsonStringOrNull(localIp) + ",";
    payload += "\"reported_mac\":" + jsonStringOrNull(WiFi.macAddress()) + ",";
    payload += "\"reported_rssi_dbm\":" + String(WiFi.RSSI()) + ",";
    payload += "\"reported_ssid\":" + jsonStringOrNull(reportedSsid) + ",";
    payload += "\"reported_bssid\":" + jsonStringOrNull(reportedBssid) + ",";
    payload += "\"reported_wifi_channel\":";
    payload += wifiChannel >= 1 && wifiChannel <= 14 ? String(wifiChannel) : String("null");
    payload += ",\"reported_gateway\":" + jsonStringOrNull(reportedGateway) + ",";
    payload += "\"reported_subnet_mask\":" + jsonStringOrNull(reportedSubnetMask) + ",";
    payload += "\"reported_relay_state\":" + jsonStringOrNull(
        String(hvacIsOn ? "ON" : "OFF")
    );
    payload += "}";

    Serial.println("===== HEARTBEAT PAYLOAD =====");
    Serial.println(payload);
    Serial.println("=============================");

    int httpCode = http.POST(payload);

    Serial.print("Heartbeat HTTP status: ");
    Serial.println(httpCode);

    if (httpCode > 0) {

        String response = http.getString();

        Serial.print("Heartbeat response: ");
        Serial.println(response);

    } else {

        Serial.print("Heartbeat request failed: ");
        Serial.println(http.errorToString(httpCode));
    }

    http.end();
}

// =========================
// Send Temperature
// =========================

void sendTemperatureReading(float temperature) {

    String timestamp = getUTCTimestamp();

    if (timestamp == "") {
        Serial.println("Temperature reading skipped: no valid UTC time.");
        return;
    }

    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    HTTPClient http;

    String url = String(BACKEND_URL) + "/readings";

    beginBackend(http, plainClient, secureClient, url);

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Credential", DEVICE_CREDENTIAL);

    String payload =
        "{"
        "\"node_id\":\"" + String(NODE_ID) + "\","
        "\"sensor_id\":\"TEMP-01\","
        "\"sensor_type\":\"temperature\","
        "\"value\":" + String(temperature, 2) + ","
        "\"unit\":\"C\","
        "\"timestamp\":\"" + timestamp + "\""
        "}";

    int httpCode = http.POST(payload);

    Serial.print("Temperature HTTP status: ");
    Serial.println(httpCode);

    if (httpCode > 0) {

        Serial.print("Temperature response: ");
        Serial.println(http.getString());

    } else {

        Serial.print("Temperature request failed: ");
        Serial.println(http.errorToString(httpCode));
    }

    http.end();
}

// =========================
// Send Humidity
// =========================

void sendHumidityReading(float humidity) {

    String timestamp = getUTCTimestamp();

    if (timestamp == "") {
        Serial.println("Humidity reading skipped: no valid UTC time.");
        return;
    }

    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    HTTPClient http;

    String url = String(BACKEND_URL) + "/readings";

    beginBackend(http, plainClient, secureClient, url);

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Credential", DEVICE_CREDENTIAL);

    String payload =
        "{"
        "\"node_id\":\"" + String(NODE_ID) + "\","
        "\"sensor_id\":\"HUM-01\","
        "\"sensor_type\":\"humidity\","
        "\"value\":" + String(humidity, 2) + ","
        "\"unit\":\"%\","
        "\"timestamp\":\"" + timestamp + "\""
        "}";

    int httpCode = http.POST(payload);

    Serial.print("Humidity HTTP status: ");
    Serial.println(httpCode);

    if (httpCode > 0) {

        Serial.print("Humidity response: ");
        Serial.println(http.getString());

    } else {

        Serial.print("Humidity request failed: ");
        Serial.println(http.errorToString(httpCode));
    }

    http.end();
}

// =========================
// Send Pressure
// =========================

void sendPressureReading(float pressure) {

    String timestamp = getUTCTimestamp();

    if (timestamp == "") {
        Serial.println("Pressure reading skipped: no valid UTC time.");
        return;
    }

    WiFiClient plainClient;
    WiFiClientSecure secureClient;
    HTTPClient http;

    String url = String(BACKEND_URL) + "/readings";

    beginBackend(http, plainClient, secureClient, url);

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Credential", DEVICE_CREDENTIAL);

    String payload =
        "{"
        "\"node_id\":\"" + String(NODE_ID) + "\","
        "\"sensor_id\":\"PRESS-01\","
        "\"sensor_type\":\"pressure\","
        "\"value\":" + String(pressure, 2) + ","
        "\"unit\":\"hPa\","
        "\"timestamp\":\"" + timestamp + "\""
        "}";

    int httpCode = http.POST(payload);

    Serial.print("Pressure HTTP status: ");
    Serial.println(httpCode);

    if (httpCode > 0) {

        Serial.print("Pressure response: ");
        Serial.println(http.getString());

    } else {

        Serial.print("Pressure request failed: ");
        Serial.println(http.errorToString(httpCode));
    }

    http.end();
}

