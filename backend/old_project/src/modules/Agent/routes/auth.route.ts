import { Router } from "express";
import asyncWrapper from "../../../middlewares/asyncWrapper";
import { schemaValidator } from "../../../middlewares/validator.middleware";
import { AgentAuthController } from "../controllers/auth.controller";
import { AgentAuthService } from "../services/auth.service";
import { agentInitiateForgotPassword, agentLoginValidationSchema, agentPasswordRecoveryValidationSchema } from "../../../utils/validation.schemas/agents/auth.schema";
import apiLimiter from "../../../middlewares/rateLimiter";

const agentAuthRouter = Router();
const agentAuthService = new AgentAuthService();
const agentAuthController = new AgentAuthController(agentAuthService);
agentAuthRouter.use(apiLimiter);
agentAuthRouter.route("/auth/login").post(schemaValidator(agentLoginValidationSchema), asyncWrapper(agentAuthController.loginController));
// agentAuthRouter.route("/auth/signup/verify").get(validateToken(), asyncWrapper(agentAuthController.verifyAccountController));
agentAuthRouter.route("/auth/forgot-password").post(schemaValidator(agentInitiateForgotPassword), asyncWrapper(agentAuthController.initiateForgotPasswordController));
agentAuthRouter.route("/auth/forgot-password/reset").post(schemaValidator(agentPasswordRecoveryValidationSchema), asyncWrapper(agentAuthController.resetPasswordController));
export default agentAuthRouter;
