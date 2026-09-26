import { Router, type Request, type Response } from "express";
import apiLimiter from "../middlewares/rateLimiter";
import merchantAuthRouter from "../modules/Merchants/routes/auth.routes";
import adminAuthRouter from "../modules/Admin/routes/auth.routes";
import agentAuthRouter from "../modules/Agent/routes/auth.route";
import utilityRouter from "../modules/Shared/routes/utils.route";

const router = Router();

router.get("/healthcheck", (req: Request, res: Response) => {
	try {
		res.send({
			uptime: Math.round(process.uptime()),
			message: "OK",
			timestamp: Date.now(),
		});
	} catch (e) {
		res.status(503).end();
	}
});

// Merchant routes
router.use("/merchant", merchantAuthRouter);
router.use("/admin", adminAuthRouter);
router.use("/agent", agentAuthRouter);

// General routes
router.use("/utils", utilityRouter);
export default router;
