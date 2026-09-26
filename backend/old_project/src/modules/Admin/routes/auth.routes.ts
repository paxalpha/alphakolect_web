  import { Router } from "express";
  import asyncWrapper from "../../../middlewares/asyncWrapper";
  import { schemaValidator } from "../../../middlewares/validator.middleware";
  import { AdminAuthController } from "../controllers/auth.controller";
  import { AdminAuthService } from "../services/auth.service";
  import { adminLoginValidationSchema, adminSignUpValidationSchema, adminPasswordRecoveryValidationSchema, adminInitiateForgotPassword } from "../../../utils/validation.schemas/admin/auth.schema"; // Validation schemas for Admin
  import { validateToken } from "../../../utils/helpers/token";
  import apiLimiter from "../../../middlewares/rateLimiter";
  import { isAuthenticatedAdmin } from "../../../middlewares/isAuthenticatedAdmin.middleware";

  const adminAuthRouter = Router();
  const adminAuthService = new AdminAuthService();
  const adminAuthController = new AdminAuthController(adminAuthService);
  adminAuthRouter.use(apiLimiter);

  adminAuthRouter.route("/auth/login").post(schemaValidator(adminLoginValidationSchema), asyncWrapper(adminAuthController.loginController));

  adminAuthRouter.route("/auth/signup").post(isAuthenticatedAdmin, schemaValidator(adminSignUpValidationSchema), asyncWrapper(adminAuthController.createAccountController));

  adminAuthRouter.route("/auth/forgot-password").post(schemaValidator(adminInitiateForgotPassword), asyncWrapper(adminAuthController.initiateForgotPasswordController));

  // adminAuthRouter.route("/auth/forgot-password/reset")
  //   .post(
  //     schemaValidator(adminPasswordRecoveryValidationSchema),
  //     asyncWrapper(adminAuthController.resetPasswordController)
  //   );

  export default adminAuthRouter;
