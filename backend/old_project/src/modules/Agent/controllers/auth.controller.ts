import type { Request, Response, NextFunction } from "express";
import BaseController from "../../../controller/base.controller";
import { createCustomError } from "../../../errors/customError";
import { StatusCodes } from "http-status-codes";
import type { IAgentAuthService } from "../services/auth.service";
import { decodeJWT, TokenTypes } from "../../../utils/helpers/token";

export class AgentAuthController extends BaseController {
	private agentAuthService: IAgentAuthService;
	constructor(authService: IAgentAuthService) {
		super();
		this.agentAuthService = authService;
	}

	// verifyAccountController = async (req: Request, res: Response, next: NextFunction) => {
	// 	try {
	// 		const {
	// 			verify: { id: agentId, type },
	// 		} = decodeJWT(req.headers.authorization!.split(" ")[1]);
	// 		if (type !== TokenTypes.AUTH_ONBOARDING) throw createCustomError("Invalid token", StatusCodes.UNAUTHORIZED);
	// 		await this.agentAuthService.completeAccountVerification(agentId);
	// 		this.successResponse(res, "Agent account verified successfully", null);
	// 	} catch (error) {
	// 		next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
	// 	}
	// };

	loginController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { email, password } = req.body;
			const agent = await this.agentAuthService.login({ email, password });
			this.successResponse(res, "Agent Login successful", agent);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	initiateForgotPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			await this.agentAuthService.initiateForgotPassword(req.body.email);
			this.successResponse(res, "Password reset link sent successfully", null);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	resetPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const {
				verify: { id: agentId, type },
			} = decodeJWT(req.headers.authorization!.split(" ")[1]);
			if (type !== TokenTypes.AUTH_FORGOT_PASSWORD) throw createCustomError("Invalid token", StatusCodes.UNAUTHORIZED);
			const { password } = req.body;
			const agent = await this.agentAuthService.resetPassword({ password, id: agentId });
			this.successResponse(res, "Password reset successful", agent);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};
}
