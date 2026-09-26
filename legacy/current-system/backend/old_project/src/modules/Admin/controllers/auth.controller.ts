import type { Request, Response, NextFunction } from "express";
import BaseController from "../../../controller/base.controller";
import { createCustomError } from "../../../errors/customError";
import { StatusCodes } from "http-status-codes";
import type { IAdminAuthService } from "../services/auth.service";
import { decodeJWT, TokenTypes } from "../../../utils/helpers/token";

export class AdminAuthController extends BaseController {
	private adminAuthService: IAdminAuthService;

	constructor(authService: IAdminAuthService) {
		super();
		this.adminAuthService = authService;
	}

	createAccountController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const adminAccount = await this.adminAuthService.createAccount(req.body);
			this.successResponse(res, "Admin account created successfully", adminAccount, StatusCodes.CREATED);
		} catch (error) {
			console.log(error);
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	loginController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { email, password } = req.body;
			const admin = await this.adminAuthService.login({ email, password });
			this.successResponse(res, "Admin login successful", admin);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	initiateForgotPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			await this.adminAuthService.initiateForgotPassword(req.body.email);
			this.successResponse(res, "Password reset link sent successfully", null);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	resetPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const {
				verify: { id: adminId, type },
			} = decodeJWT(req.headers.authorization!.split(" ")[1]);

			if (type !== TokenTypes.AUTH_FORGOT_PASSWORD) {
				throw createCustomError("Invalid token", StatusCodes.UNAUTHORIZED);
			}

			const { password } = req.body;
			const admin = await this.adminAuthService.resetPassword({ password, id: adminId });
			this.successResponse(res, "Password reset successful", admin);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};
}
