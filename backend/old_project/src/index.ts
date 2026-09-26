import app from "./app";
import config from "./config/config";
(async () => {
	try {
		app.listen(config.APP_PORT, () => {
			console.log(`Server started on port ${config.APP_PORT} 🔥🔥🔥`);
		});
		process.once("SIGUSR2", () => {
			process.kill(process.pid, "SIGUSR2");
		});

		process.on("SIGINT", () => {
			// this is only called on ctrl+c, not restart
			process.kill(process.pid, "SIGINT");
		});
	} catch (err: unknown) {
		console.error(`Unexpected error starting up the server: ${err}`);

		process.exit(1);
	}
})();
