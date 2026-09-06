import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  await pool.query("SELECT 1");
  const data = HealthCheckResponse.parse({
    status: "ok",
    database: "connected",
    serverTime: new Date().toISOString(),
  });
  res.json(data);
});

export default router;
