import type { Request, Response, NextFunction } from "express";
import BaseController from "../../../controller/base.controller";
import { createCustomError } from "../../../errors/customError";
import { StatusCodes } from "http-status-codes";
import type { IMerchantAuthService } from "../services/auth.service";
import { decodeJWT, TokenTypes } from "../../../utils/helpers/token";

export class MerchantAuthController extends BaseController {
	private merchantAuthService: IMerchantAuthService;
	constructor(authService: IMerchantAuthService) {
		super();
		this.merchantAuthService = authService;
	}

	createAccountController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { baseCurrency, ...rest } = req.body;
			const merchantAccount = await this.merchantAuthService.createAccount({
				...rest,
				baseCurrencyId: req.body.baseCurrency,
			});
			this.successResponse(res, "Merchant account created successfully", merchantAccount, StatusCodes.CREATED);
		} catch (error) {
			console.log(error);
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	verifyAccountController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const {
				verify: { id: merchantId, type },
			} = decodeJWT(req.headers.authorization!.split(" ")[1]);
			if (type !== TokenTypes.AUTH_ONBOARDING) throw createCustomError("Invalid token", StatusCodes.UNAUTHORIZED);
			await this.merchantAuthService.completeAccountVerification(merchantId);
			this.successResponse(res, "Merchant account verified successfully", null);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	loginController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { email, password } = req.body;
			const merchant = await this.merchantAuthService.login({ email, password });
			this.successResponse(res, "Merchant Login successful", merchant);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	initiateForgotPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			await this.merchantAuthService.initiateForgotPassword(req.body.email);
			this.successResponse(res, "Password reset link sent successfully", null);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	resetPasswordController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const {
				verify: { id: merchantId, type },
			} = decodeJWT(req.headers.authorization!.split(" ")[1]);
			if (type !== TokenTypes.AUTH_FORGOT_PASSWORD) throw createCustomError("Invalid token", StatusCodes.UNAUTHORIZED);
			const { password } = req.body;
			const merchant = await this.merchantAuthService.resetPassword({ password, id: merchantId });
			this.successResponse(res, "Password reset successful", merchant);
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	createAgentAccountController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { baseCurrency, ...rest } = req.body;
			const agentAccount = await this.merchantAuthService.createAgentAccount({
				...rest,
				baseCurrencyId: req.body.baseCurrency,
			});
			this.successResponse(res, "Merchant account created successfully", agentAccount, StatusCodes.CREATED);
		} catch (error) {
			console.log(error);
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	getAllAgentsController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const page = parseInt(req.query.page as string) || 1;
			const pageSize = parseInt(req.query.pageSize as string) || 10;

			const { agents, total } = await this.merchantAuthService.getAllAgents(page, pageSize);
			const totalPages = Math.ceil(total / pageSize);


			this.successResponse(res, "All agent accounts retrieved successfully", {
				agents,
				page,
				pageSize,
				total,
				totalPages
			});
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	};

	updateAgentController = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const agentId = req.params.agentId;
	
			const { name, email, phoneNumber, password } = req.body;
		
			const updated = await this.merchantAuthService.updateAgent(agentId, {
				name,
				email,
				phoneNumber,
				password,
			});


			this.successResponse(res, "gent updated successfully", updated);
			
		}catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
		
	}

	disableAgentController = async(req: Request, res: Response, next: NextFunction) => {
		try {
			const agentId = req.params.agentId;
	
			await this.merchantAuthService.disableAgent(agentId);

			this.successResponse(res, "Agent disabled successfully", []);
		
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	}

	enableAgentController = async(req: Request, res: Response, next: NextFunction) => {
		try {
			const agentId = req.params.agentId;
	
			await this.merchantAuthService.enableAgent(agentId);

			this.successResponse(res, "Agent enabled successfully", []);
		
		} catch (error) {
			next(createCustomError(error.message, error.code ?? StatusCodes.INTERNAL_SERVER_ERROR));
		}
	}

}
