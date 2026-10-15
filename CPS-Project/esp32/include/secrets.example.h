#pragma once

// Copy to secrets.h and replace each placeholder locally.
// Never commit secrets.h or real Wi-Fi/device credentials.

#define WIFI_SSID "REPLACE_WITH_WIFI_SSID"
#define WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"
#define NODE_ID "REPLACE_WITH_NODE_ID"
#define DEVICE_CREDENTIAL "REPLACE_WITH_PROVISIONED_DEVICE_CREDENTIAL"
#define BACKEND_URL "http://REPLACE_WITH_BACKEND_HOST:8001"

// Only used when BACKEND_URL starts with https://. Paste the PEM root CA that
// signed the TLS proxy's certificate; leave empty for a plain http:// backend.
static const char LOCAL_ROOT_CA_CERT[] = "";
