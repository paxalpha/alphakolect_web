export interface TAgentDTO {
	id: string;
	name: string
	email: string;
	password: string;
	phoneNumber: string | null;
	isActive: boolean;
}

export interface TSafeAgentDTO extends Omit<TAgentDTO, "password"> {}

export interface TAgentWithAccesstoken extends TSafeAgentDTO {
	accessToken: string;
	createdAt: string | Date;
	updatedAt: string | Date;
}

export interface TAgentLoginDTO extends Pick<TAgentDTO, "email" | "password"> {}

export interface TAgentPasswordRecoveryDTO {
	password: string;
	id: string;
}
