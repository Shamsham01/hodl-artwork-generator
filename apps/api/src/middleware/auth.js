const jwt = require("jsonwebtoken");
const { supabase } = require("../lib/supabase");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid token" });
    }
    req.user = data.user;
    req.userId = data.user.id;
    next();
  } catch {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

module.exports = { authMiddleware };
