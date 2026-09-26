import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { hashString } from "../../utils/helpers/index";

const prisma = new PrismaClient();

const systemAdminData = {
	email: "superadmin@paxalpha.com",
	password: "paxalpha",
	isActive: true,
	profileImageUrl: null,
};

export const seedSystemAdmin = async () => {
	try {
		const existingAdmin = await prisma.systemAdmin.findUnique({
			where: {
				email: systemAdminData.email,
			},
		});

		if (!existingAdmin) {
			const hashedPassword = hashString(systemAdminData.password);

			const systemAdmin = await prisma.systemAdmin.create({
				data: {
					...systemAdminData,
					password: hashedPassword,
				},
			});

			console.log("Super admin created:", systemAdmin);
		} else {
			console.log("Super admin already exists!");
		}
	} catch (error) {
		console.error("Error seeding super admin:", error);
	} finally {
		await prisma.$disconnect();
	}
};
