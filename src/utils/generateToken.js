require("dotenv").config(); // CARREGA O .env

const jwt = require("jsonwebtoken");

// DEBUG (obrigatório agora)
console.log("JWT_SECRET =", process.env.JWT_SECRET);

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET não foi carregado");
}

const payload = {
  user_id: 1,
  email: "teste@teste.com",
};

const token = jwt.sign(payload, process.env.JWT_SECRET, {
  expiresIn: "1d",
});

console.log("\nTOKEN GERADO COM SUCESSO:\n");
console.log(token);

