import network
import time
from machine import Pin

try:
    import urequests as requests
except ImportError:
    import requests

from config import API_TOKEN, API_URL, WIFI_PASSWORD, WIFI_SSID


SENSOR_PIN = 15
DEBOUNCE_MS = 30
POLL_MS = 10
RECONNECT_SECONDS = 5

sensor = Pin(SENSOR_PIN, Pin.IN, Pin.PULL_UP)
wifi = network.WLAN(network.STA_IF)


def connect_wifi():
    if wifi.isconnected():
        return True

    wifi.active(True)
    wifi.connect(WIFI_SSID, WIFI_PASSWORD)
    print("Connecting to Wi-Fi", end="")

    for _ in range(20):
        if wifi.isconnected():
            print("\nConnected:", wifi.ifconfig()[0])
            return True
        print(".", end="")
        time.sleep(1)

    print("\nWi-Fi connection timed out")
    return False


def send_status(occupied):
    if not connect_wifi():
        return False

    headers = {"Content-Type": "application/json"}
    if API_TOKEN:
        headers["Authorization"] = "Bearer " + API_TOKEN

    response = None
    try:
        response = requests.post(
            API_URL,
            json={"sitting": occupied, "source": "pico-w-2"},
            headers=headers,
        )
        if 200 <= response.status_code < 300:
            print("Web UI updated:", "occupied" if occupied else "empty")
            return True

        print("Web UI returned HTTP", response.status_code)
    except Exception as error:
        print("Could not update Web UI:", error)
        wifi.disconnect()
    finally:
        if response is not None:
            response.close()

    return False


def read_occupied():
    occupied = sensor.value() == 0
    time.sleep_ms(DEBOUNCE_MS)
    return occupied if (sensor.value() == 0) == occupied else None


previous = None
pending = read_occupied()

while True:
    occupied = read_occupied()

    if occupied is not None and occupied != previous:
        pending = occupied

    if pending is not None and send_status(pending):
        previous = pending
        pending = None

    if pending is not None:
        time.sleep(RECONNECT_SECONDS)
    else:
        time.sleep_ms(POLL_MS)

