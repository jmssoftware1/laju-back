import "dotenv/config";
import express from "express";
import cors from "cors";
import authLaju from "./auth-laju.js";
import lajustore from "./lajustore.js";
import modulosV6 from "./modulos-v6.js";
import modulosV7 from "./modulos-v7.js";
import operacao from "./modulos-operacao.js";
import crediarioV8 from "./modulos-crediario-v8.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Defina os links permitidos
// Remova as barras '/' do final desses links se houverem!
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",").map(url => url.trim().replace(/\/$/, "")).filter(Boolean);
app.use(cors({
 origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
  callback(new Error("Origem não autorizada"));
 },
 methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
 allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use("/api/lajustore", lajustore);
app.use("/api/v6", modulosV6);
app.use("/api/v7", modulosV7);
app.use("/api/operacao", operacao);
app.use("/api/v8/crediario", crediarioV8);
app.use("/api/auth", authLaju);

app.get("/health", (_, res) => res.status(200).json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(
    `API LajuStore na porta ${PORT}`,
  );
});
