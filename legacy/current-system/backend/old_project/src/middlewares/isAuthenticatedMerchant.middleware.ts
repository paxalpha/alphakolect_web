import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { decodeJWT } from "../utils/helpers/token";
import { errorResponse } from "../utils/helpers/responseTraits";
import { TokenTypes } from "../utils/helpers/token";
import { validateToken } from "../utils/helpers/token";

export const isAuthenticatedMerchant = (req: Request, res: Response, next: NextFunction) => {
  validateToken()(req, res, () => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(StatusCodes.UNAUTHORIZED).json(
        errorResponse({
          statusCode: StatusCodes.UNAUTHORIZED,
          message: "Unauthorized access",
          data: null,
        })
      );
    }

    const token = authHeader.split(" ")[1];
    const decoded = decodeJWT(token);

    if (!decoded.verify || decoded.verify.type !== TokenTypes.MERCHANT_LOGIN) {
      return res.status(StatusCodes.FORBIDDEN).json(
        errorResponse({
          statusCode: StatusCodes.FORBIDDEN,
          message: "Merchant privileges required",
          data: null,
        })
      );
    }
    next();
  });
};