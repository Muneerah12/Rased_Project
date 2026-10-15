# NODE-04 local HTTPS ingestion

NODE-04 reaches the local CPS ingestion gateway through a TLS reverse proxy.
The Gateway and CPS backend remain loopback-only; only the dedicated TLS
listener is permitted on the trusted LAN. Private keys, Caddy data, and the
local CA must remain outside this repository.

## Moving between Wi-Fi networks

Do not reuse an address-bound certificate after moving networks.

1. Give the RASID host and NODE-04 stable DHCP reservations on the new network.
2. Change the proxy bind address and the firewall's local/remote address scope.
3. Issue a replacement leaf certificate with the new host IP as an IP SAN, then
   change only NODE-04's HTTPS backend URL to that address and port.
4. Keep the existing embedded root CA only when the same protected local CA is
   retained. If the CA changes, replace the firmware trust anchor with the new
   CA's public certificate before building and uploading.
5. Verify TLS hostname/IP-SAN validation and authenticated `POST /heartbeat` and
   `POST /readings` before relying on telemetry.

Never use `setInsecure`, commit private keys, or expose the Gateway or CPS
backend directly to the LAN or internet.
