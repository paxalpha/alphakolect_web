import { Router } from "express";
import apiLimiter from "../../../middlewares/rateLimiter";
import { UtilityService } from "../services/utils.service";
import { UtilityController } from "../controllers/utils.controllers";

const utilityRouter = Router();
const utilityService = new UtilityService();
const utilityController = new UtilityController(utilityService);
utilityRouter.use(apiLimiter);
utilityRouter.get("/currencies", utilityController.getCurrenciesController);
export default utilityRouter;
