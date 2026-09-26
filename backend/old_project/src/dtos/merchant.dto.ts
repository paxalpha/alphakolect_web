export interface TMerchantDTO {
	id: string;
	email: string;
	businessName: string;
	businessAlias: string;
	phone: string;
	baseCurrencyId: string;
	password: string;
}

export interface TSafeMerchantDTO extends Omit<TMerchantDTO, "password"> {}

export interface TMerchantWithAccesstoken extends TSafeMerchantDTO {
	accessToken: string;
}

export interface TMerchantLoginDTO extends Pick<TMerchantDTO, "email" | "password"> {}

export interface TMerchantPasswordRecoveryDTO {
	password: string;
	id: string;
}
