# Chair Time

A tiny status site that shows whether Sam is sitting in his chair.

## Run locally

```sh
npm start
```
or
```sh
export HOST=127.0.0.1
export PORT=8080
npm start
```

If the site is mounted under a reverse proxy path, set `CHAIRTIME_BASE_PATH`:

```sh
export CHAIRTIME_BASE_PATH=/chairtime
npm start
```

With that set, the browser UI, assets, and iframe widget are served under
`/chairtime`. The root `/api/...` endpoints still work for devices that post
directly to the Node server.

## Widget embed

Load the compact iframe view with `?widget=true`:

```html
<iframe src="http://localhost:4280/?widget=true" title="Chair Time"></iframe>
```

## API

Read the current chair status:

```sh
curl http://localhost:4280/api/status
```

Read the status and computed stats:

```sh
curl http://localhost:4280/api/stats
```

Update the status:

```sh
curl -X POST http://localhost:4280/api/status \
  -H "Content-Type: application/json" \
  -d '{"sitting":true,"source":"pico-w"}'
```

The API also accepts event names that map naturally to the seat switch:

```json
{ "event": "sat_down", "source": "pico-w" }
{ "event": "stood_up", "source": "pico-w" }
```

The Pico also sends heartbeat posts to the same endpoint:

```json
{ "sitting": true, "source": "pico-w", "heartbeat": true }
```

If the server has not seen a heartbeat or status update for 30 seconds, it marks
the sensor stale and stops counting any open sitting session.

For public hosting, set `CHAIRTIME_API_TOKEN` and send it from the Pico as a bearer token:

```http
Authorization: Bearer your-secret-token
```

Session history is saved to `data/events.json`.
