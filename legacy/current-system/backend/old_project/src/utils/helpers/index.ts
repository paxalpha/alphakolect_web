import bcrypt from "bcryptjs";

export const hashString = (password: string) => bcrypt.hashSync(password, bcrypt.genSaltSync(10));
export const compareHashedSting = (password: string, hashedPassword: string) => bcrypt.compareSync(password, hashedPassword);
