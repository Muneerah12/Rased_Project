#!/usr/bin/env sh
# Issue the HTTPS certificate NODE-04 trusts, for this PC's IP on the ESP32 network.
#
#   ./issue-cert.sh <HOST_IP> <ROOT_CRT> <ROOT_KEY>
#   e.g. ./issue-cert.sh 172.20.10.12 "$APPDATA/Caddy/pki/authorities/local/root.crt" "$APPDATA/Caddy/pki/authorities/local/root.key"
#
# The IP is listed both as an IP and as a DNS name: the ESP32's mbedTLS 2.28 cannot match an
# IP-only certificate. The root must be the CA embedded in the firmware (LOCAL_ROOT_CA_CERT in
# secrets.h). Writes certs/node04.crt and certs/node04.key next to this script; never commit them.
set -eu
IP="${1:?host IP}"; ROOT_CRT="${2:?root certificate}"; ROOT_KEY="${3:?root private key}"
DIR="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$DIR"
cd "$DIR"
cat > leaf.cnf <<EOF
[req]
distinguished_name=dn
prompt=no
[dn]
CN=$IP
[ext]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=critical,IP:$IP,DNS:$IP
EOF
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout node04.key -out leaf.csr -config leaf.cnf
openssl x509 -req -in leaf.csr -CA "$ROOT_CRT" -CAkey "$ROOT_KEY" -CAcreateserial -days 365 -sha256 -extfile leaf.cnf -extensions ext -out node04.crt
rm -f leaf.csr leaf.cnf
openssl verify -CAfile "$ROOT_CRT" node04.crt
echo "Now replace {{HOST_IP}} with $IP in Caddyfile.example (save as Caddyfile) and run: caddy run --config Caddyfile --adapter caddyfile"
