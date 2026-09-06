import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fundRouter from "./fund";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fundRouter);

export default router;
