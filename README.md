# Chair Time

Chair Time is a small chair occupancy tracker. A switch connected to a Pico W 2
reports whether the chair is occupied, and a small web page shows the current sit state
along with a few basic sitting-time stats.

## What's in here

- `pi/main.py` runs on the Pico and reads the switch on GPIO 15.
- `web/server.js` serves the page and receives updates from the Pico.
- `web/data/events.json` stores the current state and session history.

## Running the site

You'll need Node 18 or newer.

```sh
#optional host and port
export HOST=0.0.0.0
export PORT=4280
# optional reverse proxy mount path, for example when serving at /chairtime
export CHAIRTIME_BASE_PATH=/chairtime
npm start
```

## Setting up the Pico

The Pico needs two files in its root directory:

- Copy `pi/main.py` to the Pico as `main.py`.
- Copy `pi/config.example.py` to the Pico as `config.py`.

Open `config.py` on the Pico and set the Wi-Fi details and the address of the
computer running the site:

```python
WIFI_SSID = "your-wifi-name"
WIFI_PASSWORD = "your-wifi-password"
API_URL = "http://YOUR_SERVER_IP:4280/api/status"
API_TOKEN = ""
```

Leave `API_TOKEN` empty unless the web server is configured to require one.


The switch is expected between GPIO 15 and ground. The pin uses the Pico's
internal pull-up, so a closed switch means the chair is occupied.

The web server applies a 5-second adjustment threshold to sitting sessions. A
brief stand-up signal still updates the live status immediately, but it will not
end the current session unless it lasts at least 5 seconds.

The Pico sends a heartbeat every 10 seconds with the current sensor state. If the
server has not seen a heartbeat or status update for 30 seconds, it marks the
chair signal disconnected and stops counting any open sitting session.

## API

Current state:

```sh
curl http://localhost:4280/api/status
```

State plus the calculated stats:

```sh
curl http://localhost:4280/api/stats
```

You can fake an update without the Pico while testing:

```sh
curl -X POST http://localhost:4280/api/status \
  -H "Content-Type: application/json" \
  -d '{"sitting":true,"source":"manual-test"}'
```


## Network access

Chairtime is meant to run over a local network.

If you really want to run it over the public internet, you may want to set
`CHAIRTIME_API_TOKEN` on the server and `API_TOKEN` in the
Pico's `config.py`. The read-only status endpoints remain public unless you add separate
authentication for them.
