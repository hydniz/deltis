// Port auto-discovery: if the desired port is taken, probe the following ones.
//
// Returns { server, port }. The caller is responsible for telling the user
// about a changed port (log box, .run.port file, GET /api/ payload).

function listenOnPort(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function listenOnAvailablePort(app, desiredPort, maxAttempts = 20) {
  for (let port = desiredPort; port < desiredPort + maxAttempts; port++) {
    try {
      const server = await listenOnPort(app, port);
      return { server, port };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      console.warn(`⚠ Port ${port} ist bereits belegt – versuche ${port + 1} …`);
    }
  }
  throw new Error(`Kein freier Port im Bereich ${desiredPort}–${desiredPort + maxAttempts - 1} gefunden.`);
}

module.exports = { listenOnAvailablePort };
