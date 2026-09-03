// Local Alertmanager sink for the `observability` compose profile.
//
// SPDX-License-Identifier: Apache-2.0
//
// deploy/alertmanager.yml's default route points here (`local-log-sink`) instead
// of at Alertmanager's built-in null receiver. All this does is print whatever it
// receives to its own stdout — inspect it with `docker compose logs -f alert-sink`.
//
// THIS IS NOT ALERTING. It notifies no one. It exists so the delivery path from a
// firing rule to *something a human can look at* is exercised end to end by
// default, instead of the previous default — a rule that fires, appears in the
// Prometheus/Alertmanager UI, and reaches nothing — which is the state that gets
// mistaken for "alerting is configured" until 3am proves otherwise.
//
// Wiring a real destination (Slack, Teams, email, PagerDuty) is still a manual
// step: see the commented receivers in alertmanager.yml. This script cannot
// replace that decision and does not try to.

const http = require('http');

const PORT = Number(process.env.PORT) || 9094;

function log(record) {
  // One JSON line per request, matching the structured-log convention used
  // elsewhere in this repo (src/server/logger.ts) so this is easy to grep.
  console.log(JSON.stringify(record));
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      // Alertmanager always sends JSON; a non-JSON body means something else is
      // probing this port. Log it as-is rather than failing.
    }
    log({
      receivedAt: new Date().toISOString(),
      sink: 'local-log-sink',
      method: req.method,
      path: req.url,
      body,
    });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('logged, not notified — see deploy/alert-sink.js\n');
  });
  req.on('error', (err) => {
    log({ receivedAt: new Date().toISOString(), sink: 'local-log-sink', error: String(err) });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log({
    startedAt: new Date().toISOString(),
    sink: 'local-log-sink',
    msg: `listening on :${PORT} — this logs alerts, it does not notify a person`,
  });
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
