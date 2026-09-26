export interface TAdminDTO {
	id: string;
	email: string;
	password: string;
	isActive: boolean;
	profileImageUrl?: string | null;
}

export interface TSafeAdminDTO extends Omit<TAdminDTO, "password"> {}

export interface TAdminWithAccesstoken extends TSafeAdminDTO {
	accessToken: string;
	createdAt: string | Date;
	updatedAt: string | Date;
}

export interface TAdminLoginDTO extends Pick<TAdminDTO, "email" | "password"> {}

export interface TAdminPasswordRecoveryDTO {
	password: string;
	id: string;
}
