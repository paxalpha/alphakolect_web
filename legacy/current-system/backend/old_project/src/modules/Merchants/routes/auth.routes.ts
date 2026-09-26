import { Router } from "express";
import asyncWrapper from "../../../middlewares/asyncWrapper";
import { schemaValidator } from "../../../middlewares/validator.middleware";
import { MerchantAuthController } from "../controllers/auth.controller";
import { MerchantAuthService } from "../services/auth.service";
import { merchantInitiateForgotPassword, merchantLoginValidationSchema, merchantPasswordRecoveryValidationSchema, merchantSignUpValidationSchema } from "../../../utils/validation.schemas/merchants/auth.schema";
import { agentSignUpValidationSchema, agentUpdateValidationSchema } from "../../../utils/validation.schemas/agents/auth.schema";
import { validateToken } from "../../../utils/helpers/token";
import apiLimiter from "../../../middlewares/rateLimiter";
import { isAuthenticatedMerchant } from "../../../middlewares/isAuthenticatedMerchant.middleware";

const merchantAuthRouter = Router();
const merchantAuthService = new MerchantAuthService();
const merchantAuthController = new MerchantAuthController(merchantAuthService);
merchantAuthRouter.use(apiLimiter);
merchantAuthRouter.route("/auth/login").post(schemaValidator(merchantLoginValidationSchema), asyncWrapper(merchantAuthController.loginController));
merchantAuthRouter.route("/auth/signup").post(schemaValidator(merchantSignUpValidationSchema), asyncWrapper(merchantAuthController.createAccountController));
merchantAuthRouter.route("/auth/signup/verify").get(validateToken(), asyncWrapper(merchantAuthController.verifyAccountController));
merchantAuthRouter.route("/auth/forgot-password").post(schemaValidator(merchantInitiateForgotPassword), asyncWrapper(merchantAuthController.initiateForgotPasswordController));
merchantAuthRouter.route("/auth/forgot-password/reset").post(schemaValidator(merchantPasswordRecoveryValidationSchema), asyncWrapper(merchantAuthController.resetPasswordController));

// agent parts
merchantAuthRouter.route("/agent/signup").post(isAuthenticatedMerchant, schemaValidator(agentSignUpValidationSchema), asyncWrapper(merchantAuthController.createAgentAccountController));
merchantAuthRouter.route("/agents").get(isAuthenticatedMerchant, asyncWrapper(merchantAuthController.getAllAgentsController));
merchantAuthRouter.route("/agent/:agentId").put(isAuthenticatedMerchant, schemaValidator(agentUpdateValidationSchema), asyncWrapper(merchantAuthController.updateAgentController));
merchantAuthRouter.route("/agent/:agentId/disable").patch(isAuthenticatedMerchant, asyncWrapper(merchantAuthController.disableAgentController));
merchantAuthRouter.route("/agent/:agentId/enable").patch(isAuthenticatedMerchant, asyncWrapper(merchantAuthController.enableAgentController));
export default merchantAuthRouter;
