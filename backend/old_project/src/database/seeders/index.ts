import { seedCurrency } from "./currency.seeder";
import { seedSystemAdmin } from "./systemAdmin.seeder";

(async () => {
	await Promise.allSettled([seedCurrency(), seedSystemAdmin()]);
})();
