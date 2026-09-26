declare global {
	namespace Express {
		interface Response {
			success(statusCode: number, message: string, data: Record<string, any> | null): Response;
		}
	}
}

export interface IResponse {
	message: string;
	data: Record<string, any>;
	error: boolean;
	statusCode: number;
}
