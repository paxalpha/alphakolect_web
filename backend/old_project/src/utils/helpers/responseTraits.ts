/** The essence of this file is to ensure that response structure is consistent throughout the API  */

interface ResponseParam {
	statusCode: number | string;
	data: unknown;
	message: string;
}
interface ApiResponse extends ResponseParam {
	error: boolean;
}

const successResponse = (params: ResponseParam): ApiResponse => {
	return {
		error: false,
		...params,
	};
};

const errorResponse = (params: ResponseParam): ApiResponse => {
	return {
		error: true,
		...params,
	};
};

export { successResponse, errorResponse };
