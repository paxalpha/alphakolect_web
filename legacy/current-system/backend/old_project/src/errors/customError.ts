import { StatusCodes } from "http-status-codes";

class CustomAPIError extends Error {
	message: string;
	code: number;
	status?: number;

	constructor(message = "Internal server error", code = 500, status: number = StatusCodes.INTERNAL_SERVER_ERROR) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const createCustomError = (message: string, code?: number) => {
	return new CustomAPIError(message, code);
};
export { CustomAPIError, createCustomError };
