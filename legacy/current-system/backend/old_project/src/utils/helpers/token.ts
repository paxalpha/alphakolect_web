import config from "../../config/config";
import jwt, { type Secret } from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { errorResponse } from "./responseTraits";
import type { NextFunction, Response, Request, RequestHandler } from "express";

export enum TokenTypes {
	AUTH_LOGIN = "auth.login",
	AUTH_FORGOT_PASSWORD = "auth.forgotPassword",
	AUTH_ONBOARDING = "auth.onboarding",
	ADMIN_LOGIN = "auth.adminLogin",
	MERCHANT_LOGIN = "auth.merchantLogin",
	// Add more token types as needed
}

interface ValidateTokenOptions {
	permission?: string;
	requiredTokenType?: TokenTypes;
	customErrorMessage?: string;
  }
  

export const generateAccessToken = (user: Record<string, string> & { type: TokenTypes }, expiry?: string | number): string => {
	const expiresIn = Number(expiry) * 60 * 24;
	const payload = {
		id: user.id,
		type: user.type,
		exp: Math.floor(Date.now() / 1000) + expiresIn,
	};
	const accessToken = jwt.sign(payload, config.JWT_SECRET as Secret);
	return accessToken;
};

export const decodeJWT = (token: string): Record<string, any> => {
	try {
		return { verify: jwt.verify(token, config.JWT_SECRET as Secret) };
	} catch (error: any) {
		return {
			verify: false,
			message: error.message,
		};
	}
};

export const validateToken = (permission?: string): any => {
	return (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
				res.status(StatusCodes.UNAUTHORIZED).json(
					errorResponse({
						statusCode: StatusCodes.UNAUTHORIZED,
						message: "User unauthorized to access this route...",
						data: null,
					}),
				);
				return;
			}

			const authData = decodeJWT(req.headers.authorization.split(" ")[1]);
			if (authData.verify) {
				if (permission?.length && !authData.verify.permissions.includes(permission)) {
					return res.status(StatusCodes.FORBIDDEN).json(
						errorResponse({
							statusCode: StatusCodes.FORBIDDEN,
							message: "This user is not granted permission to perform this action",
							data: null,
						}),
					);
				}
				next();
			} else {
				res.status(StatusCodes.UNAUTHORIZED).json(
					errorResponse({
						statusCode: StatusCodes.UNAUTHORIZED,
						message: ["/reset-password"].includes(req.url) && authData.message === "jwt expired" ? "Token expired,kindly request another verifucation link" : "User unauthorized",
						data: null,
					}),
				);
			}
		} catch (error: any) {
			res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
				errorResponse({
					statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
					message: error.message,
					data: null,
				}),
			);
		}
	};
};
