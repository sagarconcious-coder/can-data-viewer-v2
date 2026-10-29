const https = require("https");

// aeidthocpp backend - BMS app login (see bms/urls.py + bms/rest_view.py
// LoginWithPassword). Response envelope is { status: bool, message, data },
// with data keys camelCased server-side (snake_to_camel_case) - e.g.
// data.auth.token, data.userProfile, etc.
const LOGIN_URL = "https://cpo.aeidth.com/bms/loginwithpassword";

/**
 * Owns the one outbound HTTPS call this app makes (login). Kept in main,
 * mirroring serialManager/pcanManager/frameLogger - the renderer has no
 * network access of its own (nodeIntegration: false) and only talks to this
 * via the IPC handler in main.js / canApi.login in preload.js.
 */
class AuthManager {
  async login(email, password) {
    let body;
    try {
      body = JSON.stringify({ email, password });
    } catch {
      return { success: false, error: "Invalid login input" };
    }

    let parsed;
    try {
      parsed = await postJson(LOGIN_URL, body);
    } catch (err) {
      return { success: false, error: err.message || "Could not reach the login server" };
    }

    if (!parsed || typeof parsed !== "object") {
      return { success: false, error: "Unexpected response from login server" };
    }
    if (!parsed.status) {
      return { success: false, error: parsed.message || "Login failed" };
    }

    const token = parsed.data && parsed.data.auth && parsed.data.auth.token;
    if (!token) {
      return { success: false, error: "Login response did not include a token" };
    }

    return { success: true, token, user: parsed.data, message: parsed.message };
  }
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search, port } = new URL(url);
    const req = https.request(
      {
        hostname,
        port: port || 443,
        path: pathname + search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new Error(`Login server returned an invalid response (HTTP ${res.statusCode})`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Login request timed out")));
    req.on("error", (err) => reject(new Error(err.message || "Network error contacting login server")));
    req.write(body);
    req.end();
  });
}

module.exports = { AuthManager };
