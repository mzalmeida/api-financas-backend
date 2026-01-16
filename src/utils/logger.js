const fs = require("fs");
const path = require("path");

const logPath = path.join(__dirname, "../logs/acessos.log");

function registrarAcesso({ usuario, linkedin, ip }) {
  const linha = `[${new Date().toISOString()}] usuario=${usuario} linkedin=${linkedin} ip=${ip}\n`;

  fs.appendFile(logPath, linha, (err) => {
    if (err) {
      console.error("Erro ao gravar log:", err.message);
    }
  });
}

module.exports = { registrarAcesso };
