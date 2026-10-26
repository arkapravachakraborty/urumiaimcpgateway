import express from "express";

const app = express();
const PORT = parseInt(process.env["GATEWAY_PORT"] ?? "4000", 10);

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/readyz", (_req, res) => {
  res.json({ status: "ready" });
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}`);
});
