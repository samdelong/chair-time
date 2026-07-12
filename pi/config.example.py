# Copy this file to config.py on the Pico and fill in your values.
WIFI_SSID = "ZYNWIFI"
WIFI_PASSWORD = "19902555"

# Use the computer's LAN IP, not localhost. Keep /api/status on the end.
# Status changes and periodic heartbeats are posted to this URL.
API_URL = "http://192.168.69.40:4280/api/status"

# Leave blank unless CHAIRTIME_API_TOKEN is set on the web server.
API_TOKEN = ""
