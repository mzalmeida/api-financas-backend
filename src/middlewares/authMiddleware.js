const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // 1️⃣ Token não enviado
  if (!authHeader) {
    return res.status(401).json({
      erro: "Token não informado"
    });
  }

  // Esperado: "Bearer TOKEN"
  const [, token] = authHeader.split(" ");

  try {
    // 2️⃣ Valida token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3️⃣ Injeta usuário na requisição
    req.user = decoded;

    return next();
  } catch (err) {
    return res.status(401).json({
      erro: "Token inválido ou expirado"
    });
  }
};
