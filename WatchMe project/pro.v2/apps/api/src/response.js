function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNotFound(res, detail = "Not found") {
  sendJson(res, 404, { error: detail });
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}

function sendBadRequest(res, detail = "Bad request") {
  sendJson(res, 400, { error: detail });
}

module.exports = {
  sendBadRequest,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
};
